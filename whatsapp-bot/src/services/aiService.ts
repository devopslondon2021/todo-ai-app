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
}

const SYSTEM_PROMPT = `You are a task parsing assistant. Given natural language input, extract structured task information.

Current date/time: {{CURRENT_DATETIME}}

Available categories: {{CATEGORIES}}

Rules:
- Extract a clear, concise title (strip "remind me to" prefix from title)
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
  "recurrence_rule": "RRULE string or null"
}`;

// ─── Intent Classification ──────────────────────────────────────────

export type ClassifiedIntent =
  | { intent: 'add'; text: string }
  | { intent: 'remind'; text: string }
  | { intent: 'query'; search: string; timeFilter?: string }
  | { intent: 'list'; timeFilter?: string }
  | { intent: 'summary' }
  | { intent: 'unknown' };

const CLASSIFY_PROMPT = `Classify the user's intent. Return JSON with one of these structures:
- {"intent":"add","text":"task description"}
- {"intent":"remind","text":"what to remind"}
- {"intent":"query","search":"keyword","timeFilter":"today|this week|etc or omit"}
- {"intent":"list","timeFilter":"today|this week|etc or omit"}
- {"intent":"summary"}
- {"intent":"unknown"}

Rules:
- "add" = user wants to create a new task
- "remind" = user wants a reminder
- "query" = user is asking about specific tasks (e.g. "how many meetings today?"). Use singular search keyword for broader matching (e.g. "meetings" → "meeting")
- "list" = user wants to see their tasks (e.g. "show my tasks")
- "summary" = user wants an overview/summary
- "unknown" = can't determine intent
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

  return JSON.parse(content) as ParsedTask;
}
