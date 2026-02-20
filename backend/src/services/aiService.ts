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
});

const SYSTEM_PROMPT = `You are a task parsing assistant. Given natural language input, extract structured task information.

Current date/time: {{CURRENT_DATETIME}}

Available categories: {{CATEGORIES}}

Rules:
- Extract a clear, concise title
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
  "recurrence_rule": "RRULE string or null"
}`;

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
  return ParsedTaskSchema.parse(parsed);
}
