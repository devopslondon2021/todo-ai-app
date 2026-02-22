import { env } from '../config/env.js';

interface AvailabilityResult {
  free: boolean;
  conflicts: { summary: string; start: string; end: string }[];
}

interface CreateEventResult {
  eventId: string;
  htmlLink: string;
}

/** Check if a time slot is free via backend API */
export async function checkAvailability(
  userId: string,
  start: string,
  end: string
): Promise<AvailabilityResult> {
  const res = await fetch(`${env.BACKEND_URL}/api/calendar/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, start, end }),
  });

  if (res.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);

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
  const res = await fetch(`${env.BACKEND_URL}/api/calendar/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, ...opts }),
  });

  if (res.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);

  const json = (await res.json()) as { data: CreateEventResult };
  return json.data;
}
