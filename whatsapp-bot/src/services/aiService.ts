import { getAIClient, getModelName } from '../config/ai.js';

export interface ParsedTask {
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high';
  category: string | null;
  subcategory: string | null;
  due_date: string | null;
  reminder_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  is_meeting?: boolean;
  attendees?: string[] | null;
  duration_minutes?: number | null;
}

const SYSTEM_PROMPT = `You are a task parsing assistant. Given natural language input, extract structured task information.

Current date/time: {{CURRENT_DATETIME}}

Available categories: {{CATEGORIES}}

Rules:
- Extract a clear, concise title (strip "remind me to" prefix from title)
- TITLE RULES: The title is an EVENT NAME, not a command. Never include action verbs like "schedule", "add", "set up", "book", "create", or "plan" in the title.
- For meetings: use short, natural titles like "Meeting with [Name]", "Call with [Name]", "[Topic] Meeting"
- BAD titles: "Schedule a meeting to speak to Akshay", "Add a call to discuss project", "Set up meeting with Bob"
- GOOD titles: "Meeting with Akshay", "Project Discussion", "Call with Bob"
- Infer priority from urgency words (urgent/asap = high, important = medium, default = medium)
- ALWAYS assign a category from the available categories list above. Pick the best match based on context:
  - Work-related tasks (meeting, deadline, project, office, report, email, client) → "Work"
  - Personal tasks (shopping, family, exercise, home, groceries, appointment, health) → "Personal"
  - If unsure, default to "Personal"
  - NEVER return category as null
- If the task implies a subcategory (e.g. "gym" under "Personal", "food" or "meal prep" under a fitness category), return it in the "subcategory" field. Otherwise set subcategory to null.
- Parse dates relative to current date ("tomorrow", "next Monday", "in 2 hours", etc.)
- If NO date or time is mentioned at all, return BOTH due_date and reminder_time as null
- REMINDER RULES (critical):
  - If the input says "remind me to [task] at [time]" or similar, the time IS the reminder_time. Set reminder_time = that exact time. Also set due_date = same time.
  - For "add" commands with a due date but NO explicit reminder request, set reminder_time to 30 minutes before due_date.
  - IMPORTANT: reminder_time must ALWAYS be in the future (after current date/time). If the parsed time would be in the past, set it to the next occurrence (e.g. next day).
- Detect recurrence ("every day", "weekly", "every Monday") and output iCal RRULE format
- Return all dates in ISO 8601 format (UTC)
- MEETING DETECTION: If the input describes scheduling a meeting, call, event, or catch-up with someone:
  - Set is_meeting to true
  - Extract attendee names into the attendees array (e.g. "meeting with Anu and Bob" → ["Anu", "Bob"])
  - Extract duration in minutes (default 30 if not specified)
  - Set category to "Meetings"
  - If not a meeting: is_meeting = false, attendees = null, duration_minutes = null

Return ONLY valid JSON:
{
  "title": "string",
  "description": "string or null",
  "priority": "low" | "medium" | "high",
  "category": "string (REQUIRED, never null)",
  "subcategory": "string or null",
  "due_date": "ISO 8601 or null",
  "reminder_time": "ISO 8601 or null",
  "is_recurring": boolean,
  "recurrence_rule": "RRULE string or null",
  "is_meeting": boolean,
  "attendees": ["string"] or null,
  "duration_minutes": number or null
}`;

// ─── Intent Classification ──────────────────────────────────────────

export type ClassifiedIntent =
  | { intent: 'add'; text: string }
  | { intent: 'remind'; text: string }
  | { intent: 'meet'; text: string }
  | { intent: 'done'; search: string }
  | { intent: 'move'; search: string; dateText: string }
  | { intent: 'query'; search: string; timeFilter?: string }
  | { intent: 'list'; timeFilter?: string }
  | { intent: 'summary' }
  | { intent: 'unknown' };

const CLASSIFY_PROMPT = `Classify the user's intent. Return JSON with one of these structures:
- {"intent":"add","text":"task description"}
- {"intent":"remind","text":"what to remind"}
- {"intent":"meet","text":"full meeting description"}
- {"intent":"done","search":"keywords to find the task"}
- {"intent":"move","search":"keywords to find the task","dateText":"target date text"}
- {"intent":"query","search":"keyword1 keyword2","timeFilter":"today|tomorrow|this week|etc or omit"}
- {"intent":"list","timeFilter":"today|this week|overdue|etc or omit"}
- {"intent":"summary"}
- {"intent":"unknown"}

Rules:
- "add" = user wants to CREATE a new task (e.g. "add buy milk", "I need to do X")
- "remind" = user wants a reminder
- "meet" = user wants to schedule a meeting, call, event, or catch-up
- "done" = user wants to COMPLETE/finish a task (e.g. "done with dental appointment", "I finished the grocery shopping", "mark the meeting as done")
- "move" = user wants to MOVE/RESCHEDULE/POSTPONE a task to a different date (e.g. "move groceries to tomorrow", "reschedule the meeting to next Monday", "postpone dentist to Friday")
- "query" = user is ASKING about existing tasks (checking, searching, counting)
  - Patterns: "do I have...", "is there a task...", "what about...", "when is my...", "did I add...", "how many...", "any task for/about..."
  - IMPORTANT: Extract 2-3 short search keywords from the subject, NOT the full question. Strip filler words.
  - Examples:
    "Do I have any task to take Vanya's dental appointment?" → {"intent":"query","search":"vanya dental"}
    "Is there anything about groceries?" → {"intent":"query","search":"groceries"}
    "When is my meeting with Harsh?" → {"intent":"query","search":"meeting harsh"}
    "How many tasks do I have for tomorrow?" → {"intent":"query","timeFilter":"tomorrow","search":""}
    "What meetings do I have?" → {"intent":"query","search":"meeting"}
- "list" = user wants to SEE/VIEW their tasks
  - Single words like "List", "Tasks", "Pending", "Overdue" → list
  - "List all X" / "Show X" / "My X" patterns → list
  - Category-like single words ("Meetings", "Work", "Personal") → {"intent":"list","timeFilter":"<the word>"}
  - Examples:
    "List" → {"intent":"list"}
    "Tasks" → {"intent":"list"}
    "Pending" → {"intent":"list","timeFilter":"pending"}
    "Overdue" → {"intent":"list","timeFilter":"overdue"}
    "Meetings" → {"intent":"list","timeFilter":"meetings"}
    "Work" → {"intent":"list","timeFilter":"work"}
    "Show everything" → {"intent":"list"}
    "All tasks" → {"intent":"list"}
- "summary" = user wants an overview/summary
- "unknown" = can't determine intent

CRITICAL RULES:
1. If the user is ASKING about an existing task (checking/searching), classify as "query" NOT "add".
2. When in doubt between "add" and "list", prefer "list" if the input sounds like a question or request to view.
3. Single words that are nouns/categories (Meetings, Work, Personal, Shopping) should be "list" with timeFilter set to that word, NOT "add".
Return ONLY valid JSON.`;

export async function classifyIntent(input: string): Promise<ClassifiedIntent> {
  try {
    const client = getAIClient();
    const model = getModelName();

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { intent: 'unknown' };

    const parsed = JSON.parse(content);
    if (!parsed.intent) return { intent: 'unknown' };
    return parsed as ClassifiedIntent;
  } catch (err) {
    console.error('[AI] classifyIntent error:', err);
    return { intent: 'unknown' };
  }
}

// ─── Multi-Task Splitting ────────────────────────────────────────────

const SPLIT_PROMPT = `You split user input into individual tasks. The user may describe one or more tasks in a single message.

Rules:
- If the input contains MULTIPLE distinct tasks/actions/events, return each as a separate item
- Preserve ALL context for each task: time, date, person names, details
- Shared context (like "tomorrow") applies to all tasks unless overridden
- A single task = return an array with 1 item
- CRITICAL: Reminders, notifications, and modifiers about the SAME task are NOT separate tasks. Keep them together as one item:
  - "Add X and remind me in 2 minutes" = ONE task (the reminder is about X)
  - "Add X and also set priority high" = ONE task
  - "Book appointment and send me a reminder" = ONE task
  - "Add X and also add Y" = TWO tasks (genuinely different actions)
- Only split when there are genuinely DIFFERENT actions/tasks being described
- Examples:
  Input: "I have a meeting tomorrow at 8AM and need to call Sam at 14:00 and catch the train at 5PM"
  Output: {"tasks":["meeting tomorrow at 8AM","call Sam tomorrow at 14:00","catch the train tomorrow at 5PM"]}

  Input: "buy groceries and pick up laundry"
  Output: {"tasks":["buy groceries","pick up laundry"]}

  Input: "remind me to call doctor Friday at 3pm"
  Output: {"tasks":["remind me to call doctor Friday at 3pm"]}

  Input: "Add Vania's appointment and please send me the reminder in two minutes"
  Output: {"tasks":["Add Vania's appointment and remind me in two minutes"]}

  Input: "Book dental appointment tomorrow and remind me 30 minutes before"
  Output: {"tasks":["Book dental appointment tomorrow and remind me 30 minutes before"]}

Return ONLY valid JSON: {"tasks":["task1","task2",...]}`;

export async function splitMultiTaskInput(input: string): Promise<string[]> {
  try {
    const client = getAIClient();
    const model = getModelName();

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SPLIT_PROMPT },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [input];

    const parsed = JSON.parse(content) as { tasks: string[] };
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) return [input];
    return parsed.tasks;
  } catch (err) {
    console.error('[AI] splitMultiTaskInput error:', err);
    return [input];
  }
}

// ─── Task Parsing ───────────────────────────────────────────────────

export async function parseNaturalLanguage(input: string, categoryNames?: string[]): Promise<ParsedTask> {
  const client = getAIClient();
  const model = getModelName();
  const now = new Date().toISOString();

  const categories = categoryNames && categoryNames.length > 0
    ? categoryNames.join(', ')
    : 'Personal, Work';

  const systemPrompt = SYSTEM_PROMPT
    .replace('{{CURRENT_DATETIME}}', now)
    .replace('{{CATEGORIES}}', categories);

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI returned empty response');

  const result = JSON.parse(content) as ParsedTask;

  // Clean up meeting titles — strip verbose prefixes the AI copies from input
  if (result.is_meeting) {
    result.title = cleanMeetingTitle(result.title);
  }

  return result;
}

/** Strip verbose meeting prefixes and produce a short, natural title */
function cleanMeetingTitle(title: string): string {
  let cleaned = title.replace(
    /^(?:schedule|set\s*up|book|arrange|add|create|plan|have)\s+(?:a\s+)?(?:meeting|call|event|catch-?up|sync)\s+/i,
    ''
  ).trim();

  if (!cleaned || cleaned === title) return title;

  if (/^(?:about|regarding|for)\s+/i.test(cleaned)) {
    return `Meeting ${cleaned}`;
  }

  if (/^(?:with)\s+/i.test(cleaned)) {
    return `Meet ${cleaned}`;
  }

  if (/^to\s+/i.test(cleaned)) {
    cleaned = cleaned.slice(3).trim();
    if (!cleaned) return title;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const startsWithVerb = /^(?:speak|talk|discuss|review|catch|sync|meet|call|check|go\s+over|plan|prep)/i.test(cleaned);
  if (!startsWithVerb) {
    cleaned = `Meet with ${cleaned}`;
  }

  return cleaned;
}

// ─── Move Date Parsing ──────────────────────────────────────────────

const MOVE_DATE_PROMPT = `You convert relative date/time text into an ISO 8601 datetime string.

Current date/time: {{CURRENT_DATETIME}}

Rules:
- "tomorrow" = next day, keep same time or default to 09:00
- "next Monday" = the coming Monday
- "Friday" = the coming Friday (if today is Friday, use next Friday)
- "March 5th" = March 5th of the current or next year
- "in 2 days" = current date + 2 days
- Always return UTC ISO 8601 format
- If no time is specified, default to 09:00 local time (assume UTC+5:30 IST)

Return ONLY valid JSON: {"date":"2025-01-15T03:30:00.000Z"}`;

export async function parseMoveDate(dateText: string): Promise<string> {
  const client = getAIClient();
  const model = getModelName();
  const now = new Date().toISOString();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: MOVE_DATE_PROMPT.replace('{{CURRENT_DATETIME}}', now) },
      { role: 'user', content: dateText },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI returned empty response for date parsing');

  const parsed = JSON.parse(content) as { date: string };
  if (!parsed.date) throw new Error('AI did not return a date');
  return parsed.date;
}
