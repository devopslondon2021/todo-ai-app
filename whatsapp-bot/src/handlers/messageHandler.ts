import { WASocket, proto } from 'baileys';
import { parseCommand } from './commandParser.js';
import * as taskService from '../services/taskService.js';
import * as aiService from '../services/aiService.js';
import { transcribeVoiceMessage } from '../services/transcriptionService.js';
import { formatTaskList, formatHelp, formatCategoryTree, formatSummary, formatQueryResult, formatVideoList } from '../utils/formatter.js';
import * as videoService from '../services/videoService.js';
import { trackSentMessage, storeSentMessage, getMyPhoneJid } from '../connection/whatsapp.js';
import { isCallEscalationEnabled } from '../services/callService.js';
import { env } from '../config/env.js';

// Store pending tasks awaiting dedup confirmation
const pendingTasks = new Map<string, { userId: string; parsed: aiService.ParsedTask }>();

// Simple user cache to avoid repeated DB lookups (TTL: 10 min)
const userCache = new Map<string, { user: { id: string; name: string }; ts: number }>();
const USER_CACHE_TTL = 600_000;

function getCachedUser(jid: string) {
  const entry = userCache.get(jid);
  if (entry && Date.now() - entry.ts < USER_CACHE_TTL) return entry.user;
  userCache.delete(jid);
  return null;
}

/** Send a message with retry for self-chat session establishment.
 *  First send after QR pairing may fail as Signal session is being created.
 *  Retry once after a short delay to let the session stabilize. */
async function sendReply(sock: WASocket, jid: string, text: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const sent = await sock.sendMessage(jid, { text });
      if (sent?.key?.id) {
        trackSentMessage(sent.key.id);
        if (sent.message) {
          storeSentMessage(sent.key.id, sent.message);
        }
      }
      return; // success
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

/** Process add/remind commands in the background — ack already sent */
async function processAddInBackground(
  sock: WASocket,
  replyJid: string,
  jid: string,
  input: string,
  user: { id: string; name: string },
  categories: { id: string; name: string }[]
) {
  const t0 = Date.now();
  try {
    const categoryNames = categories.map(c => c.name);

    const t1 = Date.now();
    const parsed = await aiService.parseNaturalLanguage(input, categoryNames);
    console.log(`[BG] AI parsed "${parsed.title}" due=${parsed.due_date} remind=${parsed.reminder_time} (${Date.now() - t1}ms)`);

    // Dedup + category resolution in parallel
    const t2 = Date.now();
    const [duplicates, categoryId] = await Promise.all([
      taskService.findDuplicates(user.id, parsed.title),
      taskService.resolveCategoryPath(user.id, parsed.category, parsed.subcategory),
    ]);
    console.log(`[BG] dedup+cat resolved (${Date.now() - t2}ms)`);

    if (duplicates.length > 0) {
      const dupList = duplicates
        .map((d) => `• "${d.title}" (${Math.round(d.similarity_score * 100)}% match)`)
        .join('\n');
      pendingTasks.set(jid, { userId: user.id, parsed });
      await sendReply(sock, replyJid,
        `⚠️ *Similar task(s) found:*\n\n${dupList}\n\nStill create "*${parsed.title}*"?\nReply *yes* or *no*`
      );
      console.log(`[BG] DONE (dedup prompt) — ${Date.now() - t0}ms`);
      return;
    }

    const task = await taskService.createTask(user.id, parsed, categoryId);

    let reply = `✅ *${task.title}* added\n`;
    reply += `Priority: ${task.priority === 'high' ? '🔴 High' : task.priority === 'medium' ? '🟡 Medium' : '🔵 Low'}`;
    if (task.categories?.name) reply += ` · ${task.categories.name}`;
    if (task.due_date) reply += `\n📅 ${new Date(task.due_date).toLocaleString()}`;
    if (task.reminder_time) reply += `\n🔔 ${new Date(task.reminder_time).toLocaleString()}`;

    await sendReply(sock, replyJid, reply);
    console.log(`[BG] DONE ✅ task=${task.id} — ${Date.now() - t0}ms`);
  } catch (err) {
    console.error('[BG] ERROR:', err);
    try {
      await sendReply(sock, replyJid, '❌ Failed to add task. Try again.');
    } catch { /* give up */ }
  }
}

export async function handleMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const jid = msg.key?.remoteJid;
  if (!jid) return;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  const isVoiceNote = !!(msg.message?.audioMessage?.ptt);

  if (!text.trim() && !isVoiceNote) return;

  const t0 = Date.now();

  // For @lid JIDs (self-chat from linked device), reply to the phone JID
  // so the message is visible in WhatsApp's chat UI. Messages sent to @lid
  // addresses are treated as internal device-sync and aren't displayed.
  const replyJid = jid.endsWith('@lid') && getMyPhoneJid()
    ? getMyPhoneJid()!
    : jid;
  console.log(`[HANDLER] START — ${isVoiceNote ? '[voice note]' : `text="${text.slice(0, 50)}"`} from=${jid} replyTo=${replyJid}`);

  try {
    // Step 1: Get user (cached)
    const pushName = msg.pushName || undefined;
    let user = getCachedUser(replyJid);
    let categories: { id: string; name: string }[] = [];

    if (!user) {
      const freshUser = await taskService.getOrCreateUser(replyJid, pushName);
      user = { id: freshUser.id, name: freshUser.name };
      userCache.set(replyJid, { user, ts: Date.now() });
    }

    // Handle pending dedup confirmation (yes/no)
    if (pendingTasks.has(jid)) {
      const lower = text.trim().toLowerCase();
      if (lower === 'yes' || lower === 'y') {
        const { userId, parsed } = pendingTasks.get(jid)!;
        pendingTasks.delete(jid);
        const task = await taskService.createTaskFromParsed(userId, parsed);
        await sendReply(sock, replyJid, `✅ *${task.title}* added`);
        return;
      } else if (lower === 'no' || lower === 'n') {
        pendingTasks.delete(jid);
        await sendReply(sock, replyJid, '❌ Cancelled.');
        return;
      }
      pendingTasks.delete(jid);
    }

    // ── VOICE NOTE: transcribe → add pipeline ────────────────
    if (isVoiceNote) {
      if (env.AI_PROVIDER === 'ollama') {
        await sendReply(sock, replyJid, '⚠️ Voice notes require OpenAI. Switch AI_PROVIDER to "openai" to use this feature.');
        return;
      }

      await sendReply(sock, replyJid, '🎤 Processing voice note...');

      let transcribed: string | null;
      try {
        transcribed = await transcribeVoiceMessage(msg);
      } catch (err) {
        console.error('[HANDLER] Transcription error:', err);
        await sendReply(sock, replyJid, '❌ Could not transcribe voice note. Try again.');
        return;
      }

      if (!transcribed) {
        await sendReply(sock, replyJid, '❌ Could not transcribe voice note. Try again.');
        return;
      }

      console.log(`[HANDLER] Transcribed: "${transcribed.slice(0, 80)}"`);

      categories = await taskService.getCategories(user.id);
      processAddInBackground(sock, replyJid, jid, transcribed, user, categories);
      console.log(`[HANDLER] DONE (voice note ack sent, processing in bg)`);
      return;
    }

    // Step 2: Parse command (instant)
    const command = parseCommand(text);
    console.log(`[HANDLER] command=${command.type} (${Date.now() - t0}ms)`);

    switch (command.type) {
      case 'help':
        await sendReply(sock, replyJid, formatHelp(isCallEscalationEnabled()));
        break;

      // ── ADD / REMIND: fire-and-forget ──────────────────────────
      case 'add':
      case 'remind': {
        let input = command.text;
        if (command.type === 'remind') {
          // Parser gives us text after "remind "/"reminder " — strip "me to " if present
          // to avoid "remind me to me to ..." doubling
          const body = input.replace(/^me\s+(?:to\s+)?/i, '');
          input = `remind me to ${body}`;
        }

        // Instant ack — don't make WhatsApp wait
        await sendReply(sock, replyJid, `⏳ Adding...`);

        // Fetch categories then process in background
        categories = await taskService.getCategories(user.id);
        processAddInBackground(sock, replyJid, jid, input, user, categories);
        // ↑ NOT awaited — returns immediately
        console.log(`[HANDLER] DONE (ack sent, processing in bg)`);
        return;
      }

      // ── Synchronous commands (fast enough) ─────────────────────
      case 'list': {
        const tasks = await taskService.getTasksForWhatsApp(user.id, command.filter);
        await sendReply(sock, replyJid, formatTaskList(tasks));
        break;
      }

      case 'done': {
        const tasks = await taskService.getRecentTasks(user.id);
        const task = tasks[command.taskNumber - 1];
        if (!task) {
          await sendReply(sock, replyJid, `❌ Task #${command.taskNumber} not found. Use "list" to see tasks.`);
        } else {
          await taskService.markComplete(task.id);
          await sendReply(sock, replyJid, `✅ Completed: *${task.title}*`);
        }
        break;
      }

      case 'delete': {
        const tasks = await taskService.getRecentTasks(user.id);
        const task = tasks[command.taskNumber - 1];
        if (!task) {
          await sendReply(sock, replyJid, `❌ Task #${command.taskNumber} not found. Use "list" to see tasks.`);
        } else {
          await taskService.deleteTask(task.id);
          await sendReply(sock, replyJid, `🗑️ Deleted: *${task.title}*`);
        }
        break;
      }

      case 'categories': {
        const tree = await taskService.getCategoryTree(user.id);
        await sendReply(sock, replyJid, tree.length === 0 ? '📂 No categories.' : formatCategoryTree(tree));
        break;
      }

      // ── VIDEO LINK: save immediately, enrich title in background ──
      case 'video_link': {
        try {
          const saved = await videoService.saveVideo(user.id, command.url, command.platform);
          await sendReply(sock, replyJid, `📥 Added to *Videos*\n\nType *videos* to see your list.`);
          // Enrich title in background (no await)
          videoService.enrichVideoTitle(saved.id, command.url, command.platform);
        } catch (err) {
          console.error('[HANDLER] Video save error:', err);
          await sendReply(sock, replyJid, '❌ Failed to save video. Try again.');
        }
        break;
      }

      // ── VIDEOS: list or mark watched ─────────────────────────
      case 'videos': {
        if (command.subcommand === 'done' && command.taskNumber != null) {
          const vids = await videoService.getVideos(user.id);
          const video = vids[command.taskNumber - 1];
          if (!video) {
            await sendReply(sock, replyJid, `❌ Video #${command.taskNumber} not found. Use "videos" to see your list.`);
          } else {
            await videoService.markVideoWatched(video.id);
            const displayTitle = video.title.replace(/^\[(YT|IG)\]\s*/, '');
            await sendReply(sock, replyJid, `✅ Watched: *${displayTitle}*`);
          }
        } else {
          const vids = await videoService.getVideos(user.id);
          await sendReply(sock, replyJid, formatVideoList(vids));
        }
        break;
      }

      case 'summary': {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const [stats, todayTasks, upcomingReminders] = await Promise.all([
          taskService.getTaskStats(user.id),
          taskService.getTasksForWhatsApp(user.id, 'today'),
          taskService.getUpcomingReminders(user.id),
        ]);

        await sendReply(sock, replyJid, formatSummary(stats, todayTasks, upcomingReminders));
        break;
      }

      case 'unknown': {
        // AI intent classification fallback
        console.log(`[HANDLER] Classifying intent for: "${command.text.slice(0, 50)}"`);
        const classified = await aiService.classifyIntent(command.text);
        console.log(`[HANDLER] AI classified: ${classified.intent} (${Date.now() - t0}ms)`);

        switch (classified.intent) {
          case 'add': {
            await sendReply(sock, replyJid, '⏳ Adding...');
            categories = await taskService.getCategories(user.id);
            processAddInBackground(sock, replyJid, jid, classified.text, user, categories);
            return;
          }
          case 'remind': {
            await sendReply(sock, replyJid, '⏳ Adding...');
            categories = await taskService.getCategories(user.id);
            processAddInBackground(sock, replyJid, jid, `remind me to ${classified.text}`, user, categories);
            return;
          }
          case 'query': {
            const tasks = await taskService.getTasksForWhatsApp(user.id, classified.timeFilter, classified.search);
            await sendReply(sock, replyJid, formatQueryResult(tasks, classified.search, classified.timeFilter));
            break;
          }
          case 'list': {
            const tasks = await taskService.getTasksForWhatsApp(user.id, classified.timeFilter);
            await sendReply(sock, replyJid, formatTaskList(tasks));
            break;
          }
          case 'summary': {
            const todayStart2 = new Date();
            todayStart2.setHours(0, 0, 0, 0);
            const [stats2, todayTasks2, upcomingReminders2] = await Promise.all([
              taskService.getTaskStats(user.id),
              taskService.getTasksForWhatsApp(user.id, 'today'),
              taskService.getUpcomingReminders(user.id),
            ]);
            await sendReply(sock, replyJid, formatSummary(stats2, todayTasks2, upcomingReminders2));
            break;
          }
          default:
            await sendReply(sock, replyJid,
              `I didn't understand that.\n\nUse *add* [task] to create a task, or send *help* for all commands.`
            );
        }
        break;
      }
    }

    // Acknowledge recent reminders (any interaction = user is active)
    taskService.acknowledgeReminders(user.id).catch(() => {});

    console.log(`[HANDLER] DONE ✅ — ${Date.now() - t0}ms`);
  } catch (err) {
    console.error('[HANDLER] ERROR:', err);
    try {
      await sendReply(sock, replyJid, '⚠️ Something went wrong. Try again.');
    } catch { /* give up */ }
  }
}
