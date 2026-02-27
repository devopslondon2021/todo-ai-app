export type Command =
  | { type: 'add'; text: string }
  | { type: 'list'; filter?: string }
  | { type: 'done'; taskNumber: number }
  | { type: 'done_search'; search: string }
  | { type: 'delete'; taskNumber: number }
  | { type: 'remind'; text: string }
  | { type: 'meet'; text: string }
  | { type: 'categories' }
  | { type: 'summary' }
  | { type: 'help' }
  | { type: 'video_link'; url: string; platform: 'youtube' | 'instagram' }
  | { type: 'videos'; subcommand?: 'done'; taskNumber?: number }
  | { type: 'meetings' }
  | { type: 'move'; taskNumber: number; dateText: string }
  | { type: 'move_search'; search: string; dateText: string }
  | { type: 'unknown'; text: string };

/** Extract a YouTube or Instagram video URL from text */
function detectVideoLink(text: string): { url: string; platform: 'youtube' | 'instagram' } | null {
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (!urlMatch) return null;
  const url = urlMatch[0];
  const lower = url.toLowerCase();

  if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/') || lower.includes('youtube.com/shorts/')) {
    return { url, platform: 'youtube' };
  }
  if (lower.includes('instagram.com/reel/') || lower.includes('instagram.com/p/')) {
    return { url, platform: 'instagram' };
  }
  return null;
}

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'help' || lower === '/help') {
    return { type: 'help' };
  }

  if (lower === 'categories' || lower === 'cats') {
    return { type: 'categories' };
  }

  if (lower === 'summary') {
    return { type: 'summary' };
  }

  // ── Natural language reminder variants (before generic add/remind) ──
  const reminderMatch = lower.match(/^(?:add|set)\s+(?:a\s+)?reminder\s+(.+)/);
  if (reminderMatch) {
    const idx = trimmed.length - reminderMatch[1].length;
    return { type: 'remind', text: trimmed.slice(idx).trim() };
  }

  // ── Natural language add variants ──
  const addTaskMatch = lower.match(/^add\s+(?:a\s+)?task\s+(.+)/);
  if (addTaskMatch) {
    const idx = trimmed.length - addTaskMatch[1].length;
    return { type: 'add', text: trimmed.slice(idx).trim() };
  }

  // "add meeting ...", "add a meeting ...", "add a call ..." → meeting flow
  const addMeetMatch = lower.match(/^add\s+(?:a\s+)?(?:meeting|call|event|catch-?up)\s+(.+)/);
  if (addMeetMatch) {
    const idx = trimmed.length - addMeetMatch[1].length;
    return { type: 'meet', text: trimmed.slice(idx).trim() };
  }

  if (lower.startsWith('add ')) {
    return { type: 'add', text: trimmed.slice(4).trim() };
  }

  // ── Natural language list variants ──
  // Single-word list shortcuts
  if (/^(?:tasks?|pending)$/.test(lower)) {
    const filter = lower.startsWith('pending') ? 'pending' : undefined;
    return { type: 'list', filter };
  }

  if (/^(?:overdue)$/.test(lower)) {
    return { type: 'list', filter: 'overdue' };
  }

  // "all tasks", "my tasks", "show all", "show all tasks", "list all", "list everything"
  if (/^(?:all\s+tasks?|my\s+tasks?|show\s+(?:all(?:\s+tasks?)?|my\s+tasks?)|list\s+(?:all(?:\s+tasks?)?|everything)|get\s+(?:all\s+)?tasks?)$/.test(lower)) {
    return { type: 'list' };
  }

  // "today's tasks", "today tasks", "what's for today"
  if (/^(?:today'?s?\s+tasks?|what'?s?\s+(?:for\s+)?today)$/.test(lower)) {
    return { type: 'list', filter: 'today' };
  }

  // "pending tasks", "overdue tasks", "completed tasks"
  if (/^(?:pending|overdue|completed)\s+tasks?$/.test(lower)) {
    const filter = lower.split(/\s/)[0];
    return { type: 'list', filter };
  }

  // "show/get/list today's tasks", "show/get/list my tasks"
  const listNaturalMatch = lower.match(/^(?:show|get|list)\s+(?:my\s+)?(?:today'?s?\s+)?tasks?$/);
  if (listNaturalMatch) {
    const filter = lower.includes('today') ? 'today' : undefined;
    return { type: 'list', filter };
  }

  // "list meetings", "show meetings", "my meetings", "list all meetings"
  if (/^(?:(?:list|show|get)\s+(?:all\s+)?meetings?|my\s+meetings?)$/.test(lower)) {
    return { type: 'meetings' };
  }

  if (lower === 'list' || lower.startsWith('list ')) {
    const raw = trimmed.slice(4).trim() || undefined;
    // Normalize "today's tasks" → "today"
    const filter = raw?.replace(/^today'?s\s+tasks?$/i, 'today') || raw;
    return { type: 'list', filter };
  }

  if (lower.startsWith('done ')) {
    const rest = trimmed.slice(5).trim();
    const num = parseInt(rest, 10);
    if (!isNaN(num)) return { type: 'done', taskNumber: num };
    // "done with X" or "done X" — search by name
    if (rest.length >= 2) {
      const search = rest.replace(/^with\s+/i, '').replace(/^the\s+/i, '');
      return { type: 'done_search', search };
    }
  }

  if (lower.startsWith('delete ') || lower.startsWith('remove ')) {
    const prefix = lower.startsWith('delete ') ? 7 : 7;
    const num = parseInt(trimmed.slice(prefix).trim(), 10);
    if (!isNaN(num)) return { type: 'delete', taskNumber: num };
  }

  if (lower.startsWith('remind ') || lower.startsWith('reminder ')) {
    const prefix = lower.startsWith('remind ') ? 7 : 9;
    return { type: 'remind', text: trimmed.slice(prefix).trim() };
  }

  // ── Meetings command ──
  if (lower === 'meetings' || lower === 'meeting' || lower === 'calendar') {
    return { type: 'meetings' };
  }

  // ── Videos command ──
  if (lower === 'videos' || lower === 'video' || lower === 'vids') {
    return { type: 'videos' };
  }

  const videosDoneMatch = lower.match(/^(?:videos?|vids)\s+done\s+(\d+)$/);
  if (videosDoneMatch) {
    return { type: 'videos', subcommand: 'done', taskNumber: parseInt(videosDoneMatch[1], 10) };
  }

  // ── Meeting scheduling commands ──
  const meetMatch = lower.match(/^(?:schedule|setup|set\s+up|book|arrange)\s+(?:a\s+)?(?:meeting|call|event|catch-?up)\s+(.+)/);
  if (meetMatch) {
    const idx = trimmed.length - meetMatch[1].length;
    return { type: 'meet', text: trimmed.slice(idx).trim() };
  }
  if (lower.startsWith('meet ')) {
    return { type: 'meet', text: trimmed.slice(5).trim() };
  }

  // ── Move / Reschedule / Postpone ──
  const moveMatch = lower.match(/^(?:move|reschedule|postpone)\s+(\d+)\s+(?:to\s+)?(.+)/);
  if (moveMatch) {
    return { type: 'move', taskNumber: parseInt(moveMatch[1], 10), dateText: moveMatch[2].trim() };
  }
  const moveSearchMatch = lower.match(/^(?:move|reschedule|postpone)\s+(?:the\s+)?(.+?)\s+to\s+(.+)/);
  if (moveSearchMatch) {
    const search = moveSearchMatch[1].replace(/^task\s+/i, '').trim();
    // If search is just a number, treat as numbered move
    const num = parseInt(search, 10);
    if (!isNaN(num) && String(num) === search) {
      return { type: 'move', taskNumber: num, dateText: moveSearchMatch[2].trim() };
    }
    return { type: 'move_search', search, dateText: moveSearchMatch[2].trim() };
  }

  // ── Auto-detect video links ──
  const videoLink = detectVideoLink(trimmed);
  if (videoLink) {
    return { type: 'video_link', url: videoLink.url, platform: videoLink.platform };
  }

  return { type: 'unknown', text: trimmed };
}
