import { env } from '../config/env.js';

const FETCH_TIMEOUT = 25_000; // 25s — below typical proxy timeout (30s)

interface AvailabilityResult {
  free: boolean;
  conflicts: { summary: string; start: string; end: string }[];
}

interface CreateEventResult {
  eventId: string;
  htmlLink: string;
}

/** Fetch with timeout + error body extraction */
async function backendFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Backend request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract error details from a non-ok response */
async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    return json.error || `Backend error: ${res.status}`;
  } catch {
    return `Backend error: ${res.status}`;
  }
}

/** Check if a time slot is free via backend API */
export async function checkAvailability(
  userId: string,
  start: string,
  end: string
): Promise<AvailabilityResult> {
  const res = await backendFetch(`${env.BACKEND_URL}/api/calendar/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, start, end }),
  });

  if (res.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
  if (!res.ok) throw new Error(await extractError(res));

  const json = (await res.json()) as { data: AvailabilityResult };
  return json.data;
}

/** Create a calendar event via backend API */
export async function createEvent(
  userId: string,
  opts: {
    summary: string;
    description?: string;
    start: string;
    duration_minutes?: number;
    attendee_names?: string[];
  }
): Promise<CreateEventResult> {
  const res = await backendFetch(`${env.BACKEND_URL}/api/calendar/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, ...opts }),
  });

  if (res.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
  if (!res.ok) throw new Error(await extractError(res));

  const json = (await res.json()) as { data: CreateEventResult };
  return json.data;
}

/** Delete a task (and its linked calendar event if app-created) via backend API */
export async function deleteTaskWithCalendar(taskId: string): Promise<void> {
  const res = await fetch(`${env.BACKEND_URL}/api/tasks/${taskId}`, {
    method: 'DELETE',
  });

  // 204 = success, 404 = already gone
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Backend error: ${res.status}`);
  }
}
