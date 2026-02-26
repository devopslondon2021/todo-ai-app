import { getAIClient, getModelName } from '../config/ai';
import { z } from 'zod';
import type { ParsedTask } from '../types';

const ParsedTaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  due_date: z.string().nullable(),
  reminder_time: z.string().nullable(),
  is_recurring: z.boolean(),
  recurrence_rule: z.string().nullable(),
  is_meeting: z.boolean().optional().default(false),
  has_specific_time: z.boolean().optional().default(false),
  attendees: z.array(z.string()).nullable().optional().default(null),
  duration_minutes: z.number().nullable().optional().default(null),
});

const SYSTEM_PROMPT = `You are a task parsing assistant. Given natural language input, extract structured task information.

Current date/time: {{CURRENT_DATETIME}}

Available categories: {{CATEGORIES}}

Rules:
- Extract a clear, concise title (never start with "schedule a meeting" or "add a meeting")
- For meetings: use short, natural titles like "Meet with [Name]", "Call with [Name]", "Speak to [Name]", "[Topic] meeting" — pick the best fit based on context
- Infer priority from urgency words (urgent/asap = high, important = medium, default = medium)
- ALWAYS assign a category from the available categories list above. Pick the best match based on context:
  - Work-related tasks (meeting, deadline, project, office, report, email, client) → "Work"
  - Personal tasks (shopping, family, exercise, home, groceries, appointment, health) → "Personal"
  - If unsure, default to "Personal"
  - NEVER return category as null
- If the task implies a subcategory (e.g. "gym" under "Personal", "food" or "meal prep" under a fitness category), return it in the "subcategory" field. Otherwise set subcategory to null.
- Parse dates relative to current date ("tomorrow", "next Monday", "in 2 hours", etc.)
- If NO date or time is mentioned at all, return due_date as null (the system will apply a default)
- If a reminder time is explicitly mentioned, set reminder_time
- If no specific reminder but a due date exists, set reminder_time to 30 minutes before due_date
- Detect recurrence ("every day", "weekly", "every Monday") and output iCal RRULE format
- Return all dates in ISO 8601 format
- MEETING DETECTION: If the input describes scheduling a meeting, call, event, or catch-up with someone:
  - Set is_meeting to true
  - Extract attendee names into the attendees array (e.g. "meeting with Anu and Bob" → ["Anu", "Bob"])
  - Extract duration in minutes (default 15 if not specified)
  - Set category to "Meetings"
  - If not a meeting: is_meeting = false, attendees = null, duration_minutes = null
- SPECIFIC TIME DETECTION: Set has_specific_time = true when the user mentions a specific clock time (e.g. "at 3pm", "14:00", "noon", "at midnight", "at 6 in the evening"). Set has_specific_time = false for date-only references ("tomorrow", "by Friday", "next week") or when no time is mentioned at all.

Return ONLY valid JSON matching this schema:
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
  "has_specific_time": boolean,
  "attendees": ["string"] or null,
  "duration_minutes": number or null
}`;

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

  const parsed = JSON.parse(content);
  const result = ParsedTaskSchema.parse(parsed);

  // Clean up meeting titles — strip verbose prefixes the AI copies from input
  if (result.is_meeting) {
    result.title = cleanMeetingTitle(result.title);
  }

  return result;
}

/** Strip verbose meeting prefixes and produce a short, natural title */
function cleanMeetingTitle(title: string): string {
  // Strip prefixes like "schedule a meeting to...", "add a call with..."
  // Keep "about/regarding/for" — only strip "to" and "with" as they flow into natural titles
  let cleaned = title.replace(
    /^(?:schedule|set\s*up|book|arrange|add|create|plan)\s+(?:a\s+)?(?:meeting|call|event|catch-?up|sync)\s+/i,
    ''
  ).trim();

  if (!cleaned || cleaned === title) return title;

  // "with John" → "Meet with John", "to speak to X" → "Speak to X"
  // "about X" → "Meeting about X", "regarding X" → "Meeting regarding X", "for X" → "Meeting for X"
  if (/^(?:about|regarding|for)\s+/i.test(cleaned)) {
    return `Meeting ${cleaned}`;
  }

  if (/^(?:with)\s+/i.test(cleaned)) {
    return `Meet ${cleaned}`;
  }

  if (/^to\s+/i.test(cleaned)) {
    // "to speak to Aakash" → "Speak to Aakash"
    cleaned = cleaned.slice(3).trim();
    if (!cleaned) return title;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Capitalize and check if it starts with a verb
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const startsWithVerb = /^(?:speak|talk|discuss|review|catch|sync|meet|call|check|go\s+over|plan|prep)/i.test(cleaned);
  if (!startsWithVerb) {
    cleaned = `Meet with ${cleaned}`;
  }

  return cleaned;
}
