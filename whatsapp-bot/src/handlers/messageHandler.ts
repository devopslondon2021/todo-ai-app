import { WASocket, normalizeMessageContent, proto } from 'baileys';
import { parseCommand } from './commandParser.js';
import * as taskService from '../services/taskService.js';
import * as aiService from '../services/aiService.js';
import * as calendarService from '../services/calendarService.js';
import { transcribeVoiceMessage } from '../services/transcriptionService.js';
import { formatTaskList, formatTasksOnly, formatDateList, formatHelp, formatCategoryTree, formatSummary, formatQueryResult, formatVideoList, formatMeetingList } from '../utils/formatter.js';
import * as videoService from '../services/videoService.js';
import { trackSentMessage, storeSentMessage, getMyPhoneJid } from '../connection/sessionManager.js';
import { isCallEscalationEnabled } from '../services/callService.js';
import { env } from '../config/env.js';

// Store pending tasks awaiting dedup confirmation (keyed by userId)
const pendingTasks = new Map<string, { userId: string; parsed: aiService.ParsedTask }>();

// Cache last displayed task list per user (keyed by userId, TTL: 10 min)
interface CachedTask { id: string; title: string; }
const lastTaskList = new Map<string, { tasks: CachedTask[]; ts: number }>();
const TASK_LIST_TTL = 600_000;

function cacheTaskList(userId: string, tasks: { id: string; title: string }[]) {
  lastTaskList.set(userId, { tasks, ts: Date.now() });
}

function getCachedTaskList(userId: string): CachedTask[] | null {
  const entry = lastTaskList.get(userId);
  if (entry && Date.now() - entry.ts < TASK_LIST_TTL) return entry.tasks;
  lastTaskList.delete(userId);
  return null;
}

async function resolveTaskByNumber(userId: string, taskNumber: number): Promise<CachedTask | null> {
  const cached = getCachedTaskList(userId);
  if (cached) return cached[taskNumber - 1] || null;
  const tasks = await taskService.getRecentTasks(userId);
  return tasks[taskNumber - 1] || null;
}

// Simple user cache (keyed by userId, TTL: 10 min)
const userCache = new Map<string, { user: { id: string; name: string }; ts: number }>();
const USER_CACHE_TTL = 600_000;

function getCachedUser(userId: string) {
  const entry = userCache.get(userId);
  if (entry && Date.now() - entry.ts < USER_CACHE_TTL) return entry.user;
  userCache.delete(userId);
  return null;
}

/** Clear all per-user caches. Exported for test use only. */
export function _clearCaches(): void {
  userCache.clear();
  lastTaskList.clear();
  pendingTasks.clear();
}

/** Send a message with retry for self-chat session establishment. */
async function sendReply(sock: WASocket, jid: string, text: string, userId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const sent = await sock.sendMessage(jid, { text });
      if (sent?.key?.id) {
        trackSentMessage(userId, sent.key.id);
        if (sent.message) {
          storeSentMessage(userId, sent.key.id, sent.message);
        }
      }
      return;
    } catch (err) {
      if (attempt === 0) {
        console.log(`[HANDLER] sendMessage failed, retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.error(`[HANDLER] sendMessage FAILED after retry:`, err);
        throw err;
      }
    }
  }
}

/** Format a single task reply line */
function formatTaskReply(task: { title: string; priority: string; due_date: string | null; reminder_time: string | null; categories?: { name: string } | null }): string {
  let reply = `✅ *${task.title}* added\n`;
  reply += `${task.priority === 'high' ? '🔴 High' : task.priority === 'medium' ? '🟡 Medium' : '🔵 Low'}`;
  if (task.categories?.name) reply += ` · ${task.categories.name}`;
  if (task.due_date) reply += `\n📅 ${new Date(task.due_date).toLocaleString()}`;
  if (task.reminder_time) reply += `\n🔔 ${new Date(task.reminder_time).toLocaleString()}`;
  return reply;
}

/** Process a single parsed task — returns reply string */
async function processSingleTask(
  parsed: aiService.ParsedTask,
  user: { id: string; name: string },
  userId: string,
): Promise<string> {
  // ── MEETING FLOW ──
  if (parsed.is_meeting) {
    const durationMin = parsed.duration_minutes || 15;
    parsed.category = 'Meetings';

    const categoryId = await taskService.resolveCategoryPath(user.id, 'Meetings', null);

    let googleEventId: string | undefined;
    let calendarNote = '';
    let conflictWarning = '';

    const calConnected = await taskService.isCalendarConnected(user.id);

    if (calConnected && parsed.due_date) {
      try {
        const startTime = new Date(parsed.due_date);

        try {
          const avail = await calendarService.checkAvailability(
            user.id, startTime.toISOString(), durationMin
          );
          if (!avail.free) {
            conflictWarning = avail.conflicts
              .map(c => {
                const cStart = new Date(c.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const cEnd = new Date(c.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return `• "${c.summary}" ${cStart} – ${cEnd}`;
              }).join('\n');

            let altText = '';
            if (avail.alternatives?.length) {
              const altSlots = avail.alternatives.map(s => {
                const t = new Date(s.start);
                return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              }).join(', ');
              altText = `\n\n💡 *Free slots nearby:* ${altSlots}`;
            }

            return `⚠️ *Time slot is busy*\n\n${conflictWarning}${altText}\n\nTry a different time or use the app to pick an alternative slot.`;
          }
        } catch (err: any) {
          if (err.message === 'SCOPE_UPGRADE_NEEDED') {
            calendarNote = '⚠️ Reconnect Google Calendar in Settings to enable event creation';
          } else {
            console.warn('[BG] checkAvailability failed (continuing):', err.message);
          }
        }

        if (!calendarNote) {
          try {
            const event = await calendarService.createEvent(user.id, {
              summary: parsed.title, start: startTime.toISOString(),
              duration_minutes: durationMin, attendee_names: parsed.attendees || undefined,
            });
            googleEventId = event.eventId;
            calendarNote = '📅 Added to Google Calendar';
          } catch (err: any) {
            const errMsg = err.message || String(err);
            console.error('[BG] Calendar event creation FAILED:', errMsg);
            if (errMsg === 'SCOPE_UPGRADE_NEEDED') {
              return '❌ Could not create meeting — reconnect Google Calendar in Settings';
            } else if (errMsg.includes('token expired') || errMsg.includes('Token')) {
              return '❌ Could not create meeting — Google Calendar token expired. Reconnect in Settings';
            } else {
              return `❌ Could not create meeting — calendar error: ${errMsg.slice(0, 80)}\n\nPlease try again.`;
            }
          }
        }
      } catch (err) {
        console.warn('[BG] Calendar flow error:', err);
        return '❌ Could not create meeting — calendar error. Please try again.';
      }
    } else if (!calConnected) {
      calendarNote = '💡 Connect Google Calendar in Settings to auto-sync';
    }

    const task = await taskService.createTask(user.id, parsed, categoryId, googleEventId);

    let reply = `✅ *${task.title}* scheduled\n`;
    reply += `${task.priority === 'high' ? '🔴 High' : task.priority === 'medium' ? '🟡 Medium' : '🔵 Low'} · Meetings`;
    if (task.due_date) {
      const d = new Date(task.due_date);
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayPart = d.toDateString() === now.toDateString() ? 'Today'
        : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
        : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      reply += `\n🕐 ${dayPart} at ${timePart} (${durationMin}min)`;
    }
    if (parsed.attendees?.length) reply += `\n👥 ${parsed.attendees.join(', ')}`;
    if (task.reminder_time) {
      reply += `\n🔔 ${new Date(task.reminder_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (conflictWarning) reply += `\n${conflictWarning}`;
    if (calendarNote) reply += `\n${calendarNote}`;
    return reply;
  }

  // ── REGULAR TASK FLOW ──
  const [duplicates, categoryId] = await Promise.all([
    taskService.findDuplicates(user.id, parsed.title),
    taskService.resolveCategoryPath(user.id, parsed.category, parsed.subcategory),
  ]);

  if (duplicates.length > 0) {
    pendingTasks.set(userId, { userId: user.id, parsed });
    const dupList = duplicates
      .map((d) => `• "${d.title}" (${Math.round(d.similarity_score * 100)}% match)`)
      .join('\n');
    return `⚠️ *Similar task(s) found:*\n\n${dupList}\n\nStill create "*${parsed.title}*"?\nReply *yes* or *no*`;
  }

  const task = await taskService.createTask(user.id, parsed, categoryId);
  return formatTaskReply(task);
}

/** Process add/remind/meet commands in the background — ack already sent */
async function processAddInBackground(
  sock: WASocket,
  replyJid: string,
  userId: string,
  input: string,
  user: { id: string; name: string },
  categories: { id: string; name: string }[]
) {
  const t0 = Date.now();
  try {
    const categoryNames = categories.map(c => c.name);

    const taskInputs = await aiService.splitMultiTaskInput(input);
    const isMulti = taskInputs.length > 1;
    console.log(`[BG] Split into ${taskInputs.length} task(s) (${Date.now() - t0}ms)`);

    const parsedTasks = await Promise.all(
      taskInputs.map(t => aiService.parseNaturalLanguage(t, categoryNames))
    );
    console.log(`[BG] Parsed ${parsedTasks.length} task(s) (${Date.now() - t0}ms)`);

    const replies: string[] = [];
    for (const parsed of parsedTasks) {
      if (isMulti) {
        const categoryId = parsed.is_meeting
          ? await taskService.resolveCategoryPath(user.id, 'Meetings', null)
          : await taskService.resolveCategoryPath(user.id, parsed.category, parsed.subcategory);
        if (parsed.is_meeting) parsed.category = 'Meetings';
        const task = await taskService.createTask(user.id, parsed, categoryId);
        replies.push(formatTaskReply(task));
      } else {
        const reply = await processSingleTask(parsed, user, userId);
        replies.push(reply);
      }
    }

    if (isMulti) {
      await sendReply(sock, replyJid, `📋 *${parsedTasks.length} tasks added:*\n\n${replies.join('\n\n')}`, userId);
    } else {
      await sendReply(sock, replyJid, replies[0], userId);
    }

    console.log(`[BG] DONE ✅ ${parsedTasks.length} task(s) — ${Date.now() - t0}ms`);
  } catch (err) {
    console.error('[BG] ERROR:', err);
    try {
      await sendReply(sock, replyJid, '❌ Failed to add task. Try again.', userId);
    } catch { /* give up */ }
  }
}

// ─── Shared command processing ──────────────────────────────────────

async function processTextInput(
  sock: WASocket,
  replyJid: string,
  userId: string,
  text: string,
  user: { id: string; name: string },
  t0: number,
  ackSent: boolean,
): Promise<void> {
  let categories: { id: string; name: string }[] = [];

  const command = parseCommand(text);
  console.log(`[HANDLER] command=${command.type} (${Date.now() - t0}ms)`);

  switch (command.type) {
    case 'help':
      await sendReply(sock, replyJid, formatHelp(isCallEscalationEnabled()), userId);
      break;

    case 'meet': {
      if (!ackSent) await sendReply(sock, replyJid, '⏳ Scheduling meeting...', userId);
      categories = await taskService.getCategories(user.id);
      processAddInBackground(sock, replyJid, userId, `meeting ${command.text}`, user, categories);
      return;
    }

    case 'add':
    case 'remind': {
      let input = command.text;
      if (command.type === 'remind') {
        const body = input.replace(/^me\s+(?:to\s+)?/i, '');
        input = `remind me to ${body}`;
      }
      if (!ackSent) await sendReply(sock, replyJid, '⏳ Adding...', userId);
      categories = await taskService.getCategories(user.id);
      processAddInBackground(sock, replyJid, userId, input, user, categories);
      return;
    }

    case 'list': {
      const [allTasks, meetings] = await Promise.all([
        taskService.getTasksForWhatsApp(user.id, command.filter),
        command.filter ? taskService.getMeetings(user.id, command.filter) : Promise.resolve([]),
      ]);
      // Separate tasks from meetings
      const meetingIds = new Set(meetings.map((m: any) => m.id));
      const tasks = allTasks.filter((t: any) =>
        !meetingIds.has(t.id) && t.categories?.name !== 'Meetings' && !t.google_event_id
      );
      cacheTaskList(userId, tasks);
      if (command.tasksOnly) {
        await sendReply(sock, replyJid, formatTasksOnly(tasks, command.filter, meetings.length), userId);
      } else {
        await sendReply(sock, replyJid, formatDateList(tasks, meetings, command.filter), userId);
      }
      break;
    }

    case 'done': {
      const task = await resolveTaskByNumber(userId, command.taskNumber);
      if (!task) {
        await sendReply(sock, replyJid, `❌ Task #${command.taskNumber} not found. Use "list" to see tasks.`, userId);
      } else {
        await taskService.markComplete(task.id);
        await sendReply(sock, replyJid, `✅ Completed: *${task.title}*`, userId);
      }
      break;
    }

    case 'done_search': {
      const task = await taskService.findTaskByKeywords(user.id, command.search);
      if (!task) {
        await sendReply(sock, replyJid, `❌ No active task matching "${command.search}" found.`, userId);
      } else {
        await taskService.markComplete(task.id);
        await sendReply(sock, replyJid, `✅ Completed: *${task.title}*`, userId);
      }
      break;
    }

    case 'delete': {
      const task = await resolveTaskByNumber(userId, command.taskNumber);
      if (!task) {
        await sendReply(sock, replyJid, `❌ Task #${command.taskNumber} not found. Use "list" to see tasks.`, userId);
      } else {
        try {
          await calendarService.deleteTaskWithCalendar(task.id);
        } catch {
          await taskService.deleteTask(task.id);
        }
        await sendReply(sock, replyJid, `🗑️ Deleted: *${task.title}*`, userId);
      }
      break;
    }

    case 'move': {
      const task = await resolveTaskByNumber(userId, command.taskNumber);
      if (!task) {
        await sendReply(sock, replyJid, `❌ Task #${command.taskNumber} not found. Use "list" to see tasks.`, userId);
      } else {
        try {
          const newDate = await aiService.parseMoveDate(command.dateText);
          const updated = await taskService.moveTask(task.id, user.id, newDate);
          const formatted = new Date(newDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          await sendReply(sock, replyJid, `📅 *${updated.title}* moved to ${formatted}`, userId);
        } catch (err) {
          console.error('[HANDLER] Move task error:', err);
          await sendReply(sock, replyJid, '❌ Could not move task. Try again.', userId);
        }
      }
      break;
    }

    case 'move_search': {
      const task = await taskService.findTaskByKeywords(user.id, command.search);
      if (!task) {
        await sendReply(sock, replyJid, `❌ No active task matching "${command.search}" found.`, userId);
      } else {
        try {
          const newDate = await aiService.parseMoveDate(command.dateText);
          const updated = await taskService.moveTask(task.id, user.id, newDate);
          const formatted = new Date(newDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          await sendReply(sock, replyJid, `📅 *${updated.title}* moved to ${formatted}`, userId);
        } catch (err) {
          console.error('[HANDLER] Move task error:', err);
          await sendReply(sock, replyJid, '❌ Could not move task. Try again.', userId);
        }
      }
      break;
    }

    case 'categories': {
      const tree = await taskService.getCategoryTree(user.id);
      await sendReply(sock, replyJid, tree.length === 0 ? '📂 No categories.' : formatCategoryTree(tree), userId);
      break;
    }

    case 'video_link': {
      try {
        const saved = await videoService.saveVideo(user.id, command.url, command.platform);
        await sendReply(sock, replyJid, `📥 Added to *Videos*\n\nType *videos* to see your list.`, userId);
        videoService.enrichVideoTitle(saved.id, command.url, command.platform);
      } catch (err) {
        console.error('[HANDLER] Video save error:', err);
        await sendReply(sock, replyJid, '❌ Failed to save video. Try again.', userId);
      }
      break;
    }

    case 'videos': {
      if (command.subcommand === 'done' && command.taskNumber != null) {
        const vids = await videoService.getVideos(user.id);
        const video = vids[command.taskNumber - 1];
        if (!video) {
          await sendReply(sock, replyJid, `❌ Video #${command.taskNumber} not found. Use "videos" to see your list.`, userId);
        } else {
          await videoService.markVideoWatched(video.id);
          const displayTitle = video.title.replace(/^\[(YT|IG)\]\s*/, '');
          await sendReply(sock, replyJid, `✅ Watched: *${displayTitle}*`, userId);
        }
      } else {
        const vids = await videoService.getVideos(user.id);
        await sendReply(sock, replyJid, formatVideoList(vids), userId);
      }
      break;
    }

    case 'meetings': {
      const meetings = await taskService.getMeetings(user.id, command.filter);
      await sendReply(sock, replyJid, formatMeetingList(meetings), userId);
      break;
    }

    case 'summary': {
      const [stats, allTodayTasks, upcomingReminders, todayMeetings] = await Promise.all([
        taskService.getTaskStats(user.id),
        taskService.getTasksForWhatsApp(user.id, 'today'),
        taskService.getUpcomingReminders(user.id),
        taskService.getMeetings(user.id, 'today'),
      ]);
      const meetingIds = new Set(todayMeetings.map((m: any) => m.id));
      const todayTasks = allTodayTasks.filter((t: any) =>
        !meetingIds.has(t.id) && t.categories?.name !== 'Meetings' && !t.google_event_id
      );
      await sendReply(sock, replyJid, formatSummary(stats, todayTasks, upcomingReminders, todayMeetings), userId);
      break;
    }

    case 'unknown': {
      console.log(`[HANDLER] Classifying intent for: "${command.text.slice(0, 50)}"`);
      const classified = await aiService.classifyIntent(command.text);
      console.log(`[HANDLER] AI classified: ${classified.intent} (${Date.now() - t0}ms)`);

      switch (classified.intent) {
        case 'add': {
          if (!ackSent) await sendReply(sock, replyJid, '⏳ Adding...', userId);
          categories = await taskService.getCategories(user.id);
          processAddInBackground(sock, replyJid, userId, classified.text, user, categories);
          return;
        }
        case 'meet': {
          if (!ackSent) await sendReply(sock, replyJid, '⏳ Scheduling meeting...', userId);
          categories = await taskService.getCategories(user.id);
          processAddInBackground(sock, replyJid, userId, classified.text, user, categories);
          return;
        }
        case 'remind': {
          if (!ackSent) await sendReply(sock, replyJid, '⏳ Adding...', userId);
          categories = await taskService.getCategories(user.id);
          processAddInBackground(sock, replyJid, userId, `remind me to ${classified.text}`, user, categories);
          return;
        }
        case 'done': {
          const task = await taskService.findTaskByKeywords(user.id, classified.search);
          if (!task) {
            await sendReply(sock, replyJid, `❌ No active task matching "${classified.search}" found.`, userId);
          } else {
            await taskService.markComplete(task.id);
            await sendReply(sock, replyJid, `✅ Completed: *${task.title}*`, userId);
          }
          break;
        }
        case 'move': {
          const task = await taskService.findTaskByKeywords(user.id, classified.search);
          if (!task) {
            await sendReply(sock, replyJid, `❌ No active task matching "${classified.search}" found.`, userId);
          } else {
            try {
              const newDate = await aiService.parseMoveDate(classified.dateText);
              const updated = await taskService.moveTask(task.id, user.id, newDate);
              const formatted = new Date(newDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              await sendReply(sock, replyJid, `📅 *${updated.title}* moved to ${formatted}`, userId);
            } catch (err) {
              console.error('[HANDLER] Move task error:', err);
              await sendReply(sock, replyJid, '❌ Could not move task. Try again.', userId);
            }
          }
          break;
        }
        case 'query': {
          const tasks = await taskService.getTasksForWhatsApp(user.id, classified.timeFilter, classified.search);
          cacheTaskList(userId, tasks);
          await sendReply(sock, replyJid, formatQueryResult(tasks, classified.search, classified.timeFilter), userId);
          break;
        }
        case 'list': {
          const [allListTasks, listMeetings] = await Promise.all([
            taskService.getTasksForWhatsApp(user.id, classified.timeFilter),
            classified.timeFilter ? taskService.getMeetings(user.id, classified.timeFilter) : Promise.resolve([]),
          ]);
          const listMeetingIds = new Set(listMeetings.map((m: any) => m.id));
          const listTasks = allListTasks.filter((t: any) =>
            !listMeetingIds.has(t.id) && t.categories?.name !== 'Meetings' && !t.google_event_id
          );
          cacheTaskList(userId, listTasks);
          await sendReply(sock, replyJid, formatDateList(listTasks, listMeetings, classified.timeFilter), userId);
          break;
        }
        case 'summary': {
          const [stats2, allTodayTasks2, upcomingReminders2, todayMeetings2] = await Promise.all([
            taskService.getTaskStats(user.id),
            taskService.getTasksForWhatsApp(user.id, 'today'),
            taskService.getUpcomingReminders(user.id),
            taskService.getMeetings(user.id, 'today'),
          ]);
          const meetingIds2 = new Set(todayMeetings2.map((m: any) => m.id));
          const todayTasks2 = allTodayTasks2.filter((t: any) =>
            !meetingIds2.has(t.id) && t.categories?.name !== 'Meetings' && !t.google_event_id
          );
          await sendReply(sock, replyJid, formatSummary(stats2, todayTasks2, upcomingReminders2, todayMeetings2), userId);
          break;
        }
        default:
          await sendReply(sock, replyJid,
            `I didn't understand that.\n\nUse *add* [task] to create a task, or send *help* for all commands.`,
            userId
          );
      }
      break;
    }
  }

  taskService.acknowledgeReminders(user.id).catch(() => {});
}

// ─── Factory: create a per-user message handler ─────────────────────

export function createMessageHandler(userId: string): (sock: WASocket, msg: proto.IWebMessageInfo) => Promise<void> {
  return async function handleMessage(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
    const jid = msg.key?.remoteJid;
    if (!jid) return;

    // Unwrap ephemeral/viewOnce/documentWithCaption containers
    const content = normalizeMessageContent(msg.message);
    const text =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      content?.extendedTextMessage?.matchedText ||
      '';

    const isVoiceNote = !!(content?.audioMessage?.ptt);

    if (!text.trim() && !isVoiceNote) return;

    const t0 = Date.now();
    // Self-chat messages arrive from @lid JIDs, but Baileys can only send to @s.whatsapp.net
    // Use the session's myPhoneJid (already normalized) for replies
    const myJid = getMyPhoneJid(userId);
    const replyJid = jid.endsWith('@lid') && myJid ? myJid : jid;

    console.log(`[HANDLER] START — ${isVoiceNote ? '[voice note]' : `text="${text.slice(0, 50)}"`} from=${jid} replyTo=${replyJid}`);

    try {
      // Get user (cached by userId)
      let user = getCachedUser(userId);
      if (!user) {
        const freshUser = await taskService.getUserById(userId);
        if (!freshUser) {
          console.error(`[HANDLER] User ${userId} not found in DB`);
          return;
        }
        user = { id: freshUser.id, name: freshUser.name };
        userCache.set(userId, { user, ts: Date.now() });
      }

      // Handle pending dedup confirmation (yes/no) — text messages
      if (!isVoiceNote && pendingTasks.has(userId)) {
        const lower = text.trim().toLowerCase().replace(/[.\s]+$/, '');
        if (['yes', 'y', 'yeah', 'yep', 'yea', 'sure'].includes(lower)) {
          const { userId: uid, parsed } = pendingTasks.get(userId)!;
          pendingTasks.delete(userId);
          const task = await taskService.createTaskFromParsed(uid, parsed);
          await sendReply(sock, replyJid, `✅ *${task.title}* added`, userId);
          return;
        } else if (['no', 'n', 'nah', 'nope', 'cancel'].includes(lower)) {
          pendingTasks.delete(userId);
          await sendReply(sock, replyJid, '❌ Cancelled.', userId);
          return;
        }
        pendingTasks.delete(userId);
      }

      // ── VOICE NOTE ──────────────────────────────────────────────────
      if (isVoiceNote) {
        if (env.AI_PROVIDER === 'ollama') {
          await sendReply(sock, replyJid, '⚠️ Voice notes require OpenAI. Switch AI_PROVIDER to "openai" to use this feature.', userId);
          return;
        }

        await sendReply(sock, replyJid, '🎤 Processing voice note...', userId);

        let transcribed: string | null;
        try {
          transcribed = await transcribeVoiceMessage(msg);
        } catch (err) {
          console.error('[HANDLER] Transcription error:', err);
          await sendReply(sock, replyJid, '❌ Could not transcribe voice note. Try again.', userId);
          return;
        }

        if (!transcribed) {
          await sendReply(sock, replyJid, '❌ Could not transcribe voice note. Try again.', userId);
          return;
        }

        console.log(`[HANDLER] Transcribed: "${transcribed.slice(0, 80)}"`);

        if (pendingTasks.has(userId)) {
          const lower = transcribed.trim().toLowerCase().replace(/[.\s]+$/, '');
          if (['yes', 'y', 'yeah', 'yep', 'yea', 'sure'].includes(lower)) {
            const { userId: uid, parsed } = pendingTasks.get(userId)!;
            pendingTasks.delete(userId);
            const task = await taskService.createTaskFromParsed(uid, parsed);
            await sendReply(sock, replyJid, `✅ *${task.title}* added`, userId);
            console.log(`[HANDLER] DONE (voice dedup confirmed)`);
            return;
          } else if (['no', 'n', 'nah', 'nope', 'cancel'].includes(lower)) {
            pendingTasks.delete(userId);
            await sendReply(sock, replyJid, '❌ Cancelled.', userId);
            console.log(`[HANDLER] DONE (voice dedup cancelled)`);
            return;
          }
          pendingTasks.delete(userId);
        }

        await processTextInput(sock, replyJid, userId, transcribed, user, t0, true);
        console.log(`[HANDLER] DONE ✅ (voice note) — ${Date.now() - t0}ms`);
        return;
      }

      // ── TEXT MESSAGE ─────────────────────────────────────────────────
      await processTextInput(sock, replyJid, userId, text, user, t0, false);
      console.log(`[HANDLER] DONE ✅ — ${Date.now() - t0}ms`);
    } catch (err) {
      console.error('[HANDLER] ERROR:', err);
      try {
        await sendReply(sock, replyJid, '⚠️ Something went wrong. Try again.', userId);
      } catch { /* give up */ }
    }
  };
}
