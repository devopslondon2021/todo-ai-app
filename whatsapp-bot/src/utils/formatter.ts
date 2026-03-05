interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  categories?: { name: string } | null;
}

interface VideoTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

interface MeetingTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
}

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return '📋 No tasks found. Send a message to add one!';
  }

  const lines = tasks.map((t, i) => {
    const status = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
    const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    const cat = t.categories?.name ? ` [${t.categories.name}]` : '';
    const due = t.due_date ? ` 📅 ${formatDate(t.due_date)}` : '';

    return `${i + 1}. ${status} ${priority} *${t.title}*${cat}${due}`;
  });

  return `📋 *Your Tasks*\n\n${lines.join('\n')}\n\n_Reply "done [number]" to complete a task_`;
}

export function formatQueryResult(tasks: Task[], search: string, timeFilter?: string): string {
  const timeLabel = timeFilter ? ` for ${timeFilter}` : '';
  const searchLabel = search ? ` matching "${search}"` : '';

  if (tasks.length === 0) {
    return `No tasks${searchLabel}${timeLabel} found.`;
  }

  const lines = tasks.map((t, i) => {
    const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    const cat = t.categories?.name ? ` [${t.categories.name}]` : '';
    const due = t.due_date ? ` 📅 ${formatDateTime(t.due_date)}` : '';
    return `${i + 1}. ${priority} *${t.title}*${cat}${due}`;
  });

  return `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}${searchLabel}${timeLabel}:\n\n${lines.join('\n')}`;
}

export function formatVideoList(videos: VideoTask[]): string {
  if (videos.length === 0) {
    return '🎬 No saved videos. Paste a YouTube or Instagram link to save one!';
  }

  const igVideos = videos.filter(v => v.title.startsWith('[IG]'));
  const ytVideos = videos.filter(v => v.title.startsWith('[YT]'));
  const otherVideos = videos.filter(v => !v.title.startsWith('[IG]') && !v.title.startsWith('[YT]'));

  const sections: string[] = [];
  let idx = 1;

  if (igVideos.length > 0) {
    const lines = igVideos.map(v => {
      const displayTitle = v.title.replace(/^\[IG\]\s*/, '');
      const date = formatDate(v.created_at);
      return `${idx++}. 📷 *${displayTitle}* — ${date}`;
    });
    sections.push(`*Instagram*\n${lines.join('\n')}`);
  }

  if (ytVideos.length > 0) {
    const lines = ytVideos.map(v => {
      const displayTitle = v.title.replace(/^\[YT\]\s*/, '');
      const date = formatDate(v.created_at);
      return `${idx++}. ▶️ *${displayTitle}* — ${date}`;
    });
    sections.push(`*YouTube*\n${lines.join('\n')}`);
  }

  if (otherVideos.length > 0) {
    const lines = otherVideos.map(v => {
      const date = formatDate(v.created_at);
      return `${idx++}. 🎬 *${v.title}* — ${date}`;
    });
    sections.push(lines.join('\n'));
  }

  return `🎬 *Saved Videos*\n\n${sections.join('\n\n')}\n\n_Reply "videos done [number]" to mark as watched_`;
}

export function formatMeetingList(meetings: MeetingTask[]): string {
  if (meetings.length === 0) {
    return '📅 No upcoming meetings.';
  }

  const lines = meetings.map((m, i) => {
    const time = m.due_date ? formatMeetingTime(m.due_date) : 'No time set';
    // Extract meeting link from description (first line if it's a URL)
    const link = m.description?.startsWith('https://') ? m.description.split('\n')[0] : null;
    const linkText = link ? `\n   🔗 ${link}` : '';
    return `${i + 1}. 📅 *${m.title}*\n   🕐 ${time}${linkText}`;
  });

  return `📅 *Upcoming Meetings*\n\n${lines.join('\n\n')}`;
}

function formatMeetingTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let dayPart: string;
  if (d.toDateString() === now.toDateString()) dayPart = 'Today';
  else if (d.toDateString() === tomorrow.toDateString()) dayPart = 'Tomorrow';
  else dayPart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayPart} at ${timePart}`;
}

export function formatHelp(callEscalationEnabled = false): string {
  let text = `*Todo AI Bot*

*Add Tasks:*
• *add* [task] — Add a task (AI parses details)
• *add a task* [task] — Same as above
• *remind* [text] — Add a task with reminder
• *set reminder* [text] — Same as above
• Send a *voice note* to add a task

*View Tasks:*
• *list* — Show pending tasks
• *list today* — Tasks due today
• *list completed* — Completed tasks
• *list* [category] — Filter by category (e.g. list work)
• *show my tasks* / *my tasks* — Same as list

*Manage Tasks:*
• *done* [number] — Complete a task
• *delete* [number] — Delete a task
• *move* [number] *to* [date] — Reschedule a task
  _e.g. "move 2 to tomorrow", "reschedule 1 to next Monday"_

*Videos:*
• Paste a *YouTube* or *Instagram* link to save it
• *videos* (or *vids*) — List saved videos
• *videos done* [number] — Mark a video as watched

*Meetings:*
• *schedule* [details] — Create a meeting (also: setup, book, meet)
  _e.g. "schedule a meeting with Anu at 5pm tomorrow for 30mins"_
• *meetings* (or *calendar*) — List upcoming calendar events

*Other:*
• *summary* — Daily summary (stats + today's tasks + reminders)
• *categories* (or *cats*) — View your categories
• *help* (or */help*) — Show this message

*Natural Language:*
You can also ask questions naturally:
• _"How many meetings do I have today?"_
• _"Do I have any tasks for today?"_
• _"Show my work tasks"_

*Examples:*
• _add buy groceries tomorrow 5pm_
• _add submit report - high priority_
• _remind call doctor Friday at 3pm_
• _add brainstorm ideas_ (no date = brain dump)`;

  if (callEscalationEnabled) {
    text += `\n\n\u{1F4DE} _If you don't respond within 5 min, you'll get a phone call reminder_`;
  }

  return text;
}

/** Format categories as an indented tree */
export function formatCategoryTree(tree: CategoryNode[]): string {
  const lines: string[] = [];

  function walk(nodes: CategoryNode[], depth: number) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const bullet = depth === 0 ? '📁' : '└';
      lines.push(`${indent}${bullet} ${node.name}`);
      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(tree, 0);
  return `📂 *Your Categories*\n\n${lines.join('\n')}`;
}

export function formatSummary(
  stats: { total: number; pending: number; in_progress: number; completed: number },
  todayTasks: Task[],
  reminders: { id: string; reminder_time: string; tasks: any }[],
  todayMeetings: Task[] = []
): string {
  const lines: string[] = ['\uD83D\uDCCA *Daily Summary*\n'];

  // Stats
  lines.push(`*Tasks:* ${stats.total} total \u2014 ${stats.pending} pending, ${stats.in_progress} in progress, ${stats.completed} completed\n`);

  // Today's tasks
  if (todayTasks.length === 0) {
    lines.push('\uD83D\uDCCB *Due Today:* None');
  } else {
    lines.push('\uD83D\uDCCB *Due Today:*');
    todayTasks.forEach((t, i) => {
      const priority = t.priority === 'high' ? '\uD83D\uDD34' : t.priority === 'medium' ? '\uD83D\uDFE1' : '\uD83D\uDD35';
      lines.push(`${i + 1}. ${priority} *${t.title}*`);
    });
  }

  // Today's meetings
  if (todayMeetings.length > 0) {
    lines.push(`\n\uD83D\uDCC5 *Meetings (${todayMeetings.length}):*`);
    todayMeetings.forEach((m, i) => {
      const time = m.due_date ? formatTimeOnly(m.due_date) : null;
      const timePart = time ? ` \u2014 ${time}` : '';
      lines.push(`${i + 1}. *${m.title}*${timePart}`);
    });
  }

  // Upcoming reminders
  if (reminders.length > 0) {
    lines.push('\n\uD83D\uDD14 *Upcoming Reminders:*');
    reminders.forEach((r) => {
      // Supabase may return tasks as object or array depending on join
      const taskRef = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
      const title = taskRef?.title || 'Unknown task';
      const time = new Date(r.reminder_time).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      lines.push(`\u2022 ${title} \u2014 ${time}`);
    });
  }

  return lines.join('\n');
}

export function formatMorningSummary(
  tasks: { title: string; priority: string; due_date: string | null }[],
  meetings: { title: string; description: string | null; due_date: string | null }[],
  userName: string = 'there'
): string {
  const lines: string[] = [`\u2600\uFE0F *Good Morning, ${userName}!*`, "Here's your day at a glance:\n"];

  // Tasks section
  if (tasks.length > 0) {
    lines.push(`\uD83D\uDCCB *Tasks (${tasks.length})*`);
    tasks.forEach((t, i) => {
      const priority = t.priority === 'high' ? '\uD83D\uDD34' : t.priority === 'medium' ? '\uD83D\uDFE1' : '\uD83D\uDD35';
      const time = t.due_date ? formatTimeOnly(t.due_date) : null;
      const timePart = time ? ` — ${time}` : '';
      lines.push(`${i + 1}. ${priority} *${t.title}*${timePart}`);
    });
  } else {
    lines.push('\uD83D\uDCCB *Tasks:* None for today');
  }

  lines.push('');

  // Meetings section
  if (meetings.length > 0) {
    lines.push(`\uD83D\uDCC5 *Meetings (${meetings.length})*`);
    meetings.forEach((m, i) => {
      const time = m.due_date ? formatTimeOnly(m.due_date) : 'No time set';
      const link = m.description?.startsWith('https://') ? m.description.split('\n')[0] : null;
      const linkText = link ? `\n   \uD83D\uDD17 ${link}` : '';
      lines.push(`${i + 1}. *${m.title}* — ${time}${linkText}`);
    });
  } else {
    lines.push('\uD83D\uDCC5 *Meetings:* None for today');
  }

  lines.push('\nHave a productive day! \uD83D\uDCAA');
  return lines.join('\n');
}

function formatTimeOnly(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const datePart = formatDate(dateStr);

  const hours = d.getHours();
  const minutes = d.getMinutes();

  // If time is midnight (00:00), just show the date
  if (hours === 0 && minutes === 0) return datePart;

  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}
