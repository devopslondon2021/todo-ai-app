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
  | { type: 'meetings'; filter?: string }
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

/** Known time-filter words for compound filter extraction */
const TIME_WORDS = new Set(['today', 'tomorrow', 'overdue', 'pending', 'completed']);
const MULTI_WORD_TIME = ['this week', 'next week'];

/** Try to extract a time filter and leftover category from a raw filter string.
 *  e.g. "work today" → { time: 'today', category: 'work' }
 *       "today" → { time: 'today', category: undefined }
 *       "work" → { time: undefined, category: 'work' }
 */
export function splitFilter(raw: string): { time?: string; category?: string } {
  const f = raw.toLowerCase().trim();
  if (!f) return {};

  // Direct match for known time filters
  if (TIME_WORDS.has(f)) return { time: f };
  for (const mt of MULTI_WORD_TIME) {
    if (f === mt) return { time: mt };
  }

  // Try extracting multi-word time first (e.g. "work this week")
  for (const mt of MULTI_WORD_TIME) {
    if (f.includes(mt)) {
      const cat = f.replace(mt, '').trim();
      return { time: mt, category: cat || undefined };
    }
  }

  // Try extracting single-word time
  const words = f.split(/\s+/);
  for (const w of words) {
    if (TIME_WORDS.has(w)) {
      const cat = words.filter(x => x !== w).join(' ').trim();
      return { time: w, category: cat || undefined };
    }
  }

  // Check for "today's" / "tomorrow's" variants
  for (const w of words) {
    const cleaned = w.replace(/'s?$/, '');
    if (TIME_WORDS.has(cleaned)) {
      const cat = words.filter(x => x !== w).join(' ').trim();
      return { time: cleaned, category: cat || undefined };
    }
  }

  return { category: f };
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

  // Standalone "today" / "tomorrow" → list with that filter
  if (/^(today|tomorrow)$/.test(lower)) {
    return { type: 'list', filter: lower };
  }

  // "all tasks", "my tasks", "show all", "show all tasks", "list all", "list everything"
  if (/^(?:all\s+tasks?|my\s+tasks?|show\s+(?:all(?:\s+tasks?)?|my\s+tasks?)|list\s+(?:all(?:\s+tasks?)?|everything)|get\s+(?:all\s+)?tasks?)$/.test(lower)) {
    return { type: 'list' };
  }

  // "today's tasks", "today tasks", "tomorrow's tasks", "what's for today/tomorrow"
  const possessiveTaskMatch = lower.match(/^(?:(today|tomorrow)'?s?\s+tasks?|what'?s?\s+(?:for\s+)?(today|tomorrow))$/);
  if (possessiveTaskMatch) {
    return { type: 'list', filter: possessiveTaskMatch[1] || possessiveTaskMatch[2] };
  }

  // "pending tasks", "overdue tasks", "completed tasks"
  if (/^(?:pending|overdue|completed)\s+tasks?$/.test(lower)) {
    const filter = lower.split(/\s/)[0];
    return { type: 'list', filter };
  }

  // "show/get/list today's tasks", "show/get/list my tasks", "show my tasks today"
  const listNaturalMatch = lower.match(/^(?:show|get|list)\s+(?:my\s+)?(?:(?:today|tomorrow)'?s?\s+)?tasks?(?:\s+(today|tomorrow))?$/);
  if (listNaturalMatch) {
    const filter = listNaturalMatch[1] || (lower.includes('today') ? 'today' : lower.includes('tomorrow') ? 'tomorrow' : undefined);
    return { type: 'list', filter };
  }

  // ── Meetings listing (with optional time filter) ──
  // "list meetings", "show meetings today", "list today's meetings", "list all meetings tomorrow"
  const meetingsListMatch = lower.match(
    /^(?:(?:list|show|get)\s+(?:all\s+)?(?:(today'?s?|tomorrow'?s?|(?:this|next)\s+week'?s?)\s+)?meetings?(?:\s+(today|tomorrow|(?:this|next)\s+week))?|my\s+meetings?(?:\s+(today|tomorrow|(?:this|next)\s+week))?)$/
  );
  if (meetingsListMatch) {
    const raw = meetingsListMatch[1]?.replace(/'s?$/, '') || meetingsListMatch[2] || meetingsListMatch[3];
    return { type: 'meetings', filter: raw };
  }

  // "list meetings for today" — with preposition
  const meetingsForMatch = lower.match(
    /^(?:list|show|get)\s+(?:all\s+)?meetings?\s+(?:for|on|this)\s+(today|tomorrow|(?:this|next)\s+week)$/
  );
  if (meetingsForMatch) {
    return { type: 'meetings', filter: meetingsForMatch[1] };
  }

  // Generic "list" command — MUST come after specific list/meetings patterns above
  if (lower === 'list' || lower.startsWith('list ')) {
    const raw = lower.slice(4).trim() || undefined;
    if (!raw) return { type: 'list' };

    // Check if raw contains "meeting(s)" — route to meetings with filter
    if (/\bmeetings?\b/.test(raw)) {
      const withoutMeeting = raw.replace(/\bmeetings?\b/, '').replace(/\b(?:my|all|for|on)\b/g, '').replace(/\s+/g, ' ').trim();
      const filter = withoutMeeting || undefined;
      return { type: 'meetings', filter };
    }

    // Normalize common patterns
    const normalized = raw
      .replace(/^today'?s?\s+tasks?$/, 'today')
      .replace(/^tomorrow'?s?\s+tasks?$/, 'tomorrow');

    return { type: 'list', filter: normalized };
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

  // ── Meetings command (standalone, with optional time filter) ──
  // "meetings", "meetings today", "calendar tomorrow", "today's meetings", "today meeting"
  const meetStandaloneMatch = lower.match(
    /^(?:(?:(today|tomorrow)'?s?|((?:this|next)\s+week)'?s?)\s+meetings?|(?:meetings?|calendar)(?:\s+(today|tomorrow|(?:this|next)\s+week))?)$/
  );
  if (meetStandaloneMatch) {
    const filter = meetStandaloneMatch[1] || meetStandaloneMatch[2] || meetStandaloneMatch[3];
    return { type: 'meetings', filter };
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

  // ── Typo tolerance for "list" (e.g. "listt", "lis", "lisst") ──
  if (/^l+i+s+t*\b/i.test(lower) && !/^list\b/.test(lower) && lower.length > 2) {
    const rest = lower.replace(/^\S+\s*/, '').trim() || undefined;
    if (rest && /\bmeetings?\b/.test(rest)) {
      const withoutMeeting = rest.replace(/\bmeetings?\b/, '').replace(/\b(?:my|all|for|on)\b/g, '').replace(/\s+/g, ' ').trim();
      return { type: 'meetings', filter: withoutMeeting || undefined };
    }
    return { type: 'list', filter: rest };
  }

  return { type: 'unknown', text: trimmed };
}
