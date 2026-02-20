export type Command =
  | { type: 'add'; text: string }
  | { type: 'list'; filter?: string }
  | { type: 'done'; taskNumber: number }
  | { type: 'delete'; taskNumber: number }
  | { type: 'remind'; text: string }
  | { type: 'categories' }
  | { type: 'help' }
  | { type: 'natural'; text: string };

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'help' || lower === '/help') {
    return { type: 'help' };
  }

  if (lower === 'categories' || lower === 'cats') {
    return { type: 'categories' };
  }

  if (lower.startsWith('add ')) {
    return { type: 'add', text: trimmed.slice(4).trim() };
  }

  if (lower === 'list' || lower.startsWith('list ')) {
    const filter = trimmed.slice(4).trim() || undefined;
    return { type: 'list', filter };
  }

  if (lower.startsWith('done ')) {
    const num = parseInt(trimmed.slice(5).trim(), 10);
    if (!isNaN(num)) return { type: 'done', taskNumber: num };
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

  // Default: treat as natural language
  return { type: 'natural', text: trimmed };
}
