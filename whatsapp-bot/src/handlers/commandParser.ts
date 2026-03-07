export type Command =
  | { type: 'add'; text: string }
  | { type: 'list'; filter?: string; tasksOnly?: boolean }
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

const DAY_NAME_PATTERN = /^(?:sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)$/;
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SPECIFIC_DATE_PATTERN = new RegExp(`^(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}|${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}[/\\-]\\d{1,2})$`);
const PREFIXED_DAY_PATTERN = /^(?:this|next)\s+(?:sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)$/;

/** Check if a string looks like a date filter (day name, specific date, or prefixed day) */
function isDateFilter(s: string): boolean {
  const lower = s.toLowerCase().trim();
  if (DAY_NAME_PATTERN.test(lower)) return true;
  if (PREFIXED_DAY_PATTERN.test(lower)) return true;
  if (lower === 'day after tomorrow') return true;
  // Specific dates: "10th march", "march 10", "10/3", "the 10th"
  const cleaned = lower.replace(/\b(the|of|on)\b/g, '').trim();
  if (SPECIFIC_DATE_PATTERN.test(cleaned)) return true;
  // Just a number like "10th" or "the 10th"
  if (/^\d{1,2}(?:st|nd|rd|th)?$/.test(cleaned)) return true;
  return false;
}

/** Extract a date filter from natural language, stripping filler words */
function extractDateFromNatural(text: string): string | undefined {
  const stripped = text
    .replace(/\?+$/, '')
    .replace(/\b(do|does|i|have|any|anything|what(?:'?s)?|is|are|there|my|for|on|the|tasks?|meetings?|schedule|happening|planned|going|stuff|things|lined\s+up|free|busy|am|show|get|list)\b/gi, '')
    .replace(/['']/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!stripped) return undefined;
  // Check if what remains is a recognizable date
  if (TIME_WORDS.has(stripped.toLowerCase())) return stripped.toLowerCase();
  for (const mt of MULTI_WORD_TIME) {
    if (stripped.toLowerCase() === mt) return mt;
  }
  if (isDateFilter(stripped)) return stripped.toLowerCase();
  return undefined;
}

/** Known time-filter words for compound filter extraction */
const TIME_WORDS = new Set([
  'today', 'tomorrow', 'yesterday', 'overdue', 'pending', 'completed',
  'sunday', 'sun', 'monday', 'mon', 'tuesday', 'tue', 'tues',
  'wednesday', 'wed', 'thursday', 'thu', 'thurs', 'friday', 'fri', 'saturday', 'sat',
]);
const MULTI_WORD_TIME = ['this week', 'next week', 'day after tomorrow',
  'this sunday', 'this monday', 'this tuesday', 'this wednesday', 'this thursday', 'this friday', 'this saturday',
  'next sunday', 'next monday', 'next tuesday', 'next wednesday', 'next thursday', 'next friday', 'next saturday',
];

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
    return { type: 'list', filter, tasksOnly: true };
  }

  // "tasks on friday", "tasks tomorrow", "tasks on 10th march", "tasks for monday"
  const tasksOnDateMatch = lower.match(/^tasks?\s+(?:on|for)?\s*(.+)/);
  if (tasksOnDateMatch) {
    const dateStr = tasksOnDateMatch[1].replace(/\b(?:the|on|for)\b/g, '').trim();
    if (dateStr && (TIME_WORDS.has(dateStr) || isDateFilter(dateStr))) {
      return { type: 'list', filter: dateStr, tasksOnly: true };
    }
    // Check multi-word time
    for (const mt of MULTI_WORD_TIME) {
      if (dateStr === mt) return { type: 'list', filter: dateStr, tasksOnly: true };
    }
  }

  if (/^(?:overdue)$/.test(lower)) {
    return { type: 'list', filter: 'overdue' };
  }

  // Standalone "today" / "tomorrow" / "yesterday" / day names → list with that filter
  if (/^(today|tomorrow|yesterday)$/.test(lower)) {
    return { type: 'list', filter: lower };
  }
  if (isDateFilter(lower)) {
    return { type: 'list', filter: lower };
  }

  // "all tasks", "my tasks", "show all", "show all tasks", "list all", "list everything"
  if (/^(?:all\s+tasks?|my\s+tasks?|show\s+(?:all(?:\s+tasks?)?|my\s+tasks?)|list\s+(?:all(?:\s+tasks?)?|everything)|get\s+(?:all\s+)?tasks?)$/.test(lower)) {
    return { type: 'list', ...((/\btasks?\b/.test(lower)) && { tasksOnly: true }) };
  }

  // "today's tasks", "today tasks", "tomorrow's tasks", "what's for today/tomorrow"
  const possessiveTaskMatch = lower.match(/^(?:(today|tomorrow)'?s?\s+tasks?|what'?s?\s+(?:for\s+)?(today|tomorrow))$/);
  if (possessiveTaskMatch) {
    const filter = possessiveTaskMatch[1] || possessiveTaskMatch[2];
    const hasTask = /\btasks?\b/.test(lower);
    return { type: 'list', filter, ...(hasTask && { tasksOnly: true }) };
  }

  // "pending tasks", "overdue tasks", "completed tasks"
  if (/^(?:pending|overdue|completed)\s+tasks?$/.test(lower)) {
    const filter = lower.split(/\s/)[0];
    return { type: 'list', filter, tasksOnly: true };
  }

  // "show/get/list today's tasks", "show/get/list my tasks", "show my tasks today"
  const listNaturalMatch = lower.match(/^(?:show|get|list)\s+(?:my\s+)?(?:(?:today|tomorrow)'?s?\s+)?tasks?(?:\s+(today|tomorrow))?$/);
  if (listNaturalMatch) {
    const filter = listNaturalMatch[1] || (lower.includes('today') ? 'today' : lower.includes('tomorrow') ? 'tomorrow' : undefined);
    return { type: 'list', filter, tasksOnly: true };
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

    // Check if user specifically asked for "tasks" (not generic list)
    const hasTaskWord = /\btasks?\b/.test(raw);

    // Normalize common patterns: strip "tasks" filler, possessives
    const normalized = raw
      .replace(/'s?\b/g, '')       // remove possessives
      .replace(/\btasks?\b/g, '')  // remove "task"/"tasks"
      .replace(/\b(?:my|for|on|the)\b/g, '') // remove filler
      .replace(/\s+/g, ' ')
      .trim() || undefined;

    return { type: 'list', filter: normalized, ...(hasTaskWord && { tasksOnly: true }) };
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
  // "meetings", "meetings friday", "meetings on 10th march", "calendar tomorrow", "today's meetings"
  const meetStandaloneMatch = lower.match(/^(?:meetings?|calendar)\s*(.*)$/);
  if (meetStandaloneMatch) {
    const rest = meetStandaloneMatch[1].replace(/\b(?:on|for|the)\b/g, '').trim();
    if (!rest) return { type: 'meetings' };
    if (TIME_WORDS.has(rest) || isDateFilter(rest)) return { type: 'meetings', filter: rest };
    for (const mt of MULTI_WORD_TIME) {
      if (rest === mt) return { type: 'meetings', filter: rest };
    }
    // Still return as meetings with the raw filter for compatibility
    return { type: 'meetings', filter: rest || undefined };
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

  // ── Possessive day patterns: "friday's tasks", "monday's meetings" ──
  const possessiveDayMatch = lower.match(/^(.+?)'?s?\s+(?:tasks?|schedule)$/);
  if (possessiveDayMatch) {
    const dayPart = possessiveDayMatch[1].trim();
    if (isDateFilter(dayPart) || TIME_WORDS.has(dayPart)) {
      return { type: 'list', filter: dayPart };
    }
  }
  const possessiveMeetMatch = lower.match(/^(.+?)'?s?\s+meetings?$/);
  if (possessiveMeetMatch) {
    const dayPart = possessiveMeetMatch[1].trim();
    if (isDateFilter(dayPart) || TIME_WORDS.has(dayPart)) {
      return { type: 'meetings', filter: dayPart };
    }
  }

  // ── Natural language questions about tasks/meetings/schedule ──
  // "do I have tasks tomorrow?", "what's on friday?", "anything on 10th march?",
  // "am I free on monday?", "what's my schedule for friday?", "any meetings tomorrow?"
  const isQuestion = /^(?:do|does|what(?:'?s)?|any|anything|is|are|am|have|show|get)\b/.test(lower) ||
    lower.endsWith('?');
  if (isQuestion) {
    const dateFilter = extractDateFromNatural(lower);
    if (dateFilter) {
      // Determine if asking specifically about meetings
      if (/\bmeetings?\b/i.test(lower)) {
        return { type: 'meetings', filter: dateFilter };
      }
      // "am I free" → meetings check
      if (/\b(?:free|busy|available|booked)\b/i.test(lower)) {
        return { type: 'meetings', filter: dateFilter };
      }
      // Everything else → list (tasks + meetings for that date)
      return { type: 'list', filter: dateFilter };
    }
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
