import { google, calendar_v3 } from 'googleapis';
import { getSupabase } from '../config/supabase';
import { env } from '../config/env';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const MEETINGS_CATEGORY = 'Meetings';

interface GoogleCreds {
  clientId: string;
  clientSecret: string;
}

/** Fetch Google credentials from the user's DB row, falling back to .env */
async function getGoogleCredentials(userId?: string): Promise<GoogleCreds | null> {
  if (userId) {
    const { data, error } = await getSupabase()
      .from('users')
      .select('google_client_id, google_client_secret')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn(`[CALENDAR] getGoogleCredentials DB error for user ${userId}:`, error.message, error.code);
    }

    if (!error && data?.google_client_id && data?.google_client_secret) {
      return { clientId: data.google_client_id, clientSecret: data.google_client_secret };
    }
  }

  // Fallback to .env
  const envId = process.env.GOOGLE_CLIENT_ID;
  const envSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  console.error(`[CALENDAR] NOT_CONFIGURED — no credentials in DB (user=${userId}) or env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)`);
  return null;
}

/** Check if Google Calendar credentials are configured (DB or .env) */
export async function isConfigured(userId?: string): Promise<boolean> {
  const creds = await getGoogleCredentials(userId);
  return creds !== null;
}

function getOAuth2Client(creds: GoogleCreds) {
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
}

/** Generate the Google OAuth consent URL */
export async function getAuthUrl(userId: string): Promise<string> {
  const creds = await getGoogleCredentials(userId);
  if (!creds) throw new Error('NOT_CONFIGURED');

  const oauth2Client = getOAuth2Client(creds);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: userId,
    prompt: 'consent',
  });
}

/** Exchange the auth code for tokens, store them, and run initial sync */
export async function handleCallback(code: string, userId: string): Promise<void> {
  const creds = await getGoogleCredentials(userId);
  if (!creds) throw new Error('NOT_CONFIGURED');

  const oauth2Client = getOAuth2Client(creds);
  const { tokens } = await oauth2Client.getToken(code);

  await getSupabase()
    .from('users')
    .update({
      google_access_token: tokens.access_token,
      google_refresh_token: tokens.refresh_token,
      google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      google_calendar_connected: true,
    })
    .eq('id', userId);

  // Initial sync + register push notifications
  await syncCalendar(userId);
  await watchCalendar(userId).catch(err =>
    console.warn('[CALENDAR] Post-connect watch registration failed:', err.message)
  );
}

/** Check if a user has Google Calendar connected */
export async function getStatus(userId: string): Promise<{ connected: boolean }> {
  const { data } = await getSupabase()
    .from('users')
    .select('google_calendar_connected')
    .eq('id', userId)
    .single();

  return { connected: !!data?.google_calendar_connected };
}

/** Disconnect Google Calendar — clear tokens and stop watch */
export async function disconnect(userId: string): Promise<void> {
  // Stop watch channel before revoking tokens
  await stopWatch(userId).catch(() => {});

  // Try to revoke the token
  try {
    const { data: user } = await getSupabase()
      .from('users')
      .select('google_access_token')
      .eq('id', userId)
      .single();

    if (user?.google_access_token) {
      const creds = await getGoogleCredentials(userId);
      if (creds) {
        const oauth2Client = getOAuth2Client(creds);
        oauth2Client.setCredentials({ access_token: user.google_access_token });
        await oauth2Client.revokeToken(user.google_access_token).catch(() => {});
      }
    }
  } catch {
    // Best-effort revocation
  }

  await getSupabase()
    .from('users')
    .update({
      google_access_token: null,
      google_refresh_token: null,
      google_token_expiry: null,
      google_calendar_connected: false,
    })
    .eq('id', userId);
}

/** Save Google OAuth credentials for a user */
export async function saveCredentials(userId: string, clientId: string, clientSecret: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ google_client_id: clientId, google_client_secret: clientSecret })
    .eq('id', userId);

  if (error) throw error;
}

/** Build an authenticated Google Calendar client for a user */
async function getAuthenticatedCalendar(userId: string) {
  const { data: user } = await getSupabase()
    .from('users')
    .select('google_access_token, google_refresh_token, google_token_expiry')
    .eq('id', userId)
    .single();

  if (!user?.google_refresh_token) {
    throw new Error('Google Calendar not connected');
  }

  const creds = await getGoogleCredentials(userId);
  if (!creds) throw new Error('NOT_CONFIGURED');

  const oauth2Client = getOAuth2Client(creds);
  oauth2Client.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
    expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : undefined,
  });

  oauth2Client.on('tokens', (tokens) => {
    const updates: Record<string, any> = {};
    if (tokens.access_token) updates.google_access_token = tokens.access_token;
    if (tokens.expiry_date) updates.google_token_expiry = new Date(tokens.expiry_date).toISOString();
    if (tokens.refresh_token) updates.google_refresh_token = tokens.refresh_token;
    if (Object.keys(updates).length > 0) {
      Promise.resolve(getSupabase().from('users').update(updates).eq('id', userId))
        .then(() => console.log(`[CALENDAR] Tokens persisted for user ${userId}`))
        .catch((err: any) => console.error(`[CALENDAR] Token persist failed:`, err.message));
    }
  });

  // Force token refresh if expired or about to expire (within 5 min)
  const now = Date.now();
  const expiry = user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : 0;
  if (expiry && expiry - now < 5 * 60_000) {
    console.log(`[CALENDAR] Token expiring soon for user ${userId}, forcing refresh`);
    try {
      const res = await oauth2Client.getAccessToken();
      if (res.token) {
        oauth2Client.setCredentials({ ...oauth2Client.credentials, access_token: res.token });
      }
    } catch (err: any) {
      console.error(`[CALENDAR] Token refresh failed for user ${userId}:`, err.message);
      throw new Error('Google Calendar token expired — please reconnect in Settings');
    }
  }

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/** Check if a time slot is free on the user's primary calendar */
export async function checkAvailability(
  userId: string,
  start: string,
  end: string
): Promise<{ free: boolean; conflicts: { summary: string; start: string; end: string }[] }> {
  try {
    const calendar = await getAuthenticatedCalendar(userId);

    // Get events in the time range for conflict details
    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsRes.data.items || [];
    const conflicts = events.map(e => ({
      summary: e.summary || 'Busy',
      start: e.start?.dateTime || e.start?.date || start,
      end: e.end?.dateTime || e.end?.date || end,
    }));

    return { free: conflicts.length === 0, conflicts };
  } catch (err: any) {
    if (err.code === 403 || err.status === 403) {
      throw new Error('SCOPE_UPGRADE_NEEDED');
    }
    throw err;
  }
}

/** Create an event on the user's primary Google Calendar */
export async function createEvent(
  userId: string,
  opts: {
    summary: string;
    description?: string;
    start: string;
    duration_minutes?: number;
    attendee_names?: string[];
  }
): Promise<{ eventId: string; htmlLink: string }> {
  try {
    const calendar = await getAuthenticatedCalendar(userId);
    const durationMs = (opts.duration_minutes || 15) * 60 * 1000;
    const startDate = new Date(opts.start);
    const endDate = new Date(startDate.getTime() + durationMs);

    const description = [
      opts.description || '',
      opts.attendee_names?.length ? `Attendees: ${opts.attendee_names.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: opts.summary,
        description: description || undefined,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      },
    });

    return {
      eventId: res.data.id || '',
      htmlLink: res.data.htmlLink || '',
    };
  } catch (err: any) {
    if (err.code === 403 || err.status === 403) {
      throw new Error('SCOPE_UPGRADE_NEEDED');
    }
    throw err;
  }
}

/** Update an existing Google Calendar event (title/time changes) */
export async function updateEvent(
  userId: string,
  eventId: string,
  updates: { summary?: string; start?: string; duration_minutes?: number },
): Promise<void> {
  try {
    const calendar = await getAuthenticatedCalendar(userId);
    const patch: Record<string, any> = {};

    if (updates.summary) patch.summary = updates.summary;
    if (updates.start) {
      const startDate = new Date(updates.start);
      patch.start = { dateTime: startDate.toISOString() };
      const durationMs = (updates.duration_minutes || 15) * 60 * 1000;
      patch.end = { dateTime: new Date(startDate.getTime() + durationMs).toISOString() };
    }

    if (Object.keys(patch).length === 0) return;

    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: patch,
    });
    console.log(`[CALENDAR] Updated event ${eventId} for user ${userId}`);
  } catch (err: any) {
    if (err.code === 404 || err.status === 404) {
      console.warn(`[CALENDAR] Event ${eventId} not found — skipping update`);
      return;
    }
    if (err.code === 403 || err.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
    throw err;
  }
}

/**
 * Safely delete an event from Google Calendar.
 * Guardrails:
 * 1. Only deletes if the task was created by our app (google_event_created_by_app = true)
 * 2. Skips past events (meeting already happened)
 * 3. Verifies the event exists on Google before deleting
 * 4. Logs every delete for audit trail
 */
export async function safeDeleteEvent(
  userId: string,
  task: { id: string; google_event_id?: string | null; google_event_created_by_app?: boolean; due_date?: string | null; title?: string },
): Promise<{ deleted: boolean; reason?: string }> {
  const eventId = task.google_event_id;
  if (!eventId) return { deleted: false, reason: 'no_event_id' };

  // Guard 1: Only delete events our app created, never synced events
  // If the column doesn't exist yet (undefined), allow delete for backward compat
  if (task.google_event_created_by_app === false) {
    console.log(`[CALENDAR] SKIP delete — event ${eventId} was synced, not created by app (task ${task.id})`);
    return { deleted: false, reason: 'synced_event' };
  }

  // Guard 2: Don't delete past events
  if (task.due_date && new Date(task.due_date) < new Date()) {
    console.log(`[CALENDAR] SKIP delete — event ${eventId} is in the past (task ${task.id})`);
    return { deleted: false, reason: 'past_event' };
  }

  try {
    const calendar = await getAuthenticatedCalendar(userId);

    // Guard 3: Verify event exists and fetch it for audit log
    let eventSummary: string | undefined;
    try {
      const existing = await calendar.events.get({ calendarId: 'primary', eventId });
      eventSummary = existing.data.summary || undefined;
    } catch (err: any) {
      if (err.code === 404 || err.status === 404) {
        return { deleted: false, reason: 'already_gone' };
      }
      throw err;
    }

    // Delete
    await calendar.events.delete({ calendarId: 'primary', eventId });
    console.log(`[CALENDAR] DELETED event "${eventSummary || eventId}" for task "${task.title || task.id}" (user ${userId})`);
    return { deleted: true };
  } catch (err: any) {
    if (err.code === 410 || err.status === 410) return { deleted: false, reason: 'already_gone' };
    if (err.code === 403 || err.status === 403) throw new Error('SCOPE_UPGRADE_NEEDED');
    throw err;
  }
}

/** Get or create the "Meetings" category for a user */
export async function getOrCreateMeetingsCategory(userId: string): Promise<string> {
  const { data: existing } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .eq('name', MEETINGS_CATEGORY)
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await getSupabase()
    .from('categories')
    .insert({
      user_id: userId,
      name: MEETINGS_CATEGORY,
      color: '#8B5CF6',
      icon: 'calendar',
    })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

/** Build a display title from a calendar event */
function buildEventTitle(event: calendar_v3.Schema$Event): string {
  const summary = event.summary || 'Untitled Meeting';

  // Get attendees (excluding the calendar owner / organizer)
  const attendees = (event.attendees || [])
    .filter(a => !a.self && !a.organizer && a.displayName)
    .map(a => a.displayName!);

  if (attendees.length === 0) return summary;
  if (attendees.length === 1) return `${summary} — ${attendees[0]}`;
  if (attendees.length <= 3) return `${summary} — ${attendees.join(', ')}`;
  return `${summary} — ${attendees.slice(0, 2).join(', ')} +${attendees.length - 2}`;
}

/** Extract the meeting link from an event */
function getMeetingLink(event: calendar_v3.Schema$Event): string | null {
  // Google Meet
  if (event.hangoutLink) return event.hangoutLink;

  // Conference data (Zoom, Teams, etc.)
  const entryPoints = event.conferenceData?.entryPoints;
  if (entryPoints?.length) {
    const video = entryPoints.find(e => e.entryPointType === 'video');
    if (video?.uri) return video.uri;
  }

  // Check description for URLs
  if (event.description) {
    const urlMatch = event.description.match(/https?:\/\/[^\s<>"]+(?:zoom|meet|teams|webex)[^\s<>"]*/i);
    if (urlMatch) return urlMatch[0];
  }

  // Check location for URLs
  if (event.location) {
    const urlMatch = event.location.match(/https?:\/\/\S+/);
    if (urlMatch) return urlMatch[0];
  }

  return null;
}

/** Build description with meeting link + attendees + duration */
function buildDescription(event: calendar_v3.Schema$Event, durationMinutes?: number | null): string {
  const parts: string[] = [];

  const link = getMeetingLink(event);
  if (link) parts.push(link);

  if (event.location && !event.location.startsWith('http')) {
    parts.push(`Location: ${event.location}`);
  }

  if (durationMinutes && durationMinutes > 0) {
    parts.push(`Duration: ${durationMinutes}m`);
  }

  const attendees = (event.attendees || [])
    .filter(a => !a.self)
    .map(a => a.displayName || a.email || 'Unknown')
    .slice(0, 10);
  if (attendees.length > 0) {
    parts.push(`Attendees: ${attendees.join(', ')}`);
  }

  return parts.join('\n') || '';
}

/** Upsert a Google Calendar event as a task */
async function upsertEventAsTask(
  userId: string,
  categoryId: string,
  event: calendar_v3.Schema$Event,
): Promise<void> {
  if (!event.id) return;

  // Skip all-day events that have no specific time (optional: include them)
  const startTime = event.start?.dateTime || event.start?.date;
  if (!startTime) return;

  // Skip cancelled events
  if (event.status === 'cancelled') {
    // If we have a task for this, mark it completed
    await getSupabase()
      .from('tasks')
      .update({ status: 'completed' })
      .eq('user_id', userId)
      .eq('google_event_id', event.id);
    return;
  }

  const title = buildEventTitle(event);
  const dueDate = new Date(startTime).toISOString();

  // Calculate duration from start/end
  const endTime = event.end?.dateTime || event.end?.date;
  let durationMinutes: number | null = null;
  if (endTime) {
    durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    if (durationMinutes <= 0) durationMinutes = null;
  }

  // Build description with duration tag embedded
  const description = buildDescription(event, durationMinutes);

  // Reminder 10 min before
  const reminderTime = new Date(new Date(startTime).getTime() - 10 * 60 * 1000).toISOString();

  // Check if task already exists
  const { data: existing } = await getSupabase()
    .from('tasks')
    .select('id, title, due_date, description')
    .eq('user_id', userId)
    .eq('google_event_id', event.id)
    .single();

  if (existing) {
    // Update if changed
    const needsUpdate =
      existing.title !== title ||
      existing.due_date !== dueDate ||
      existing.description !== description;

    if (needsUpdate) {
      await getSupabase()
        .from('tasks')
        .update({ title, description, due_date: dueDate })
        .eq('id', existing.id);

      // Update reminder time too
      if (new Date(reminderTime) > new Date()) {
        await getSupabase()
          .from('reminders')
          .update({ reminder_time: reminderTime })
          .eq('task_id', existing.id)
          .eq('is_sent', false);
      }
    }
  } else {
    // Create new task
    const insertData: Record<string, any> = {
      user_id: userId,
      category_id: categoryId,
      title,
      description,
      priority: 'medium',
      status: 'pending',
      due_date: dueDate,
      reminder_time: reminderTime,
      google_event_id: event.id,
      google_event_created_by_app: false, // synced from Google — never delete from calendar
    };

    let { data: task, error } = await getSupabase()
      .from('tasks')
      .insert(insertData)
      .select('id')
      .single();

    // If column doesn't exist yet (migration pending), retry without it
    if (error?.code === 'PGRST204' && error.message?.includes('google_event_created_by_app')) {
      delete insertData.google_event_created_by_app;
      ({ data: task, error } = await getSupabase()
        .from('tasks')
        .insert(insertData)
        .select('id')
        .single());
    }

    if (error || !task) {
      console.error(`[CALENDAR] Failed to create task for event ${event.id}:`, error);
      return;
    }

    // Create reminder if in the future
    if (new Date(reminderTime) > new Date()) {
      await getSupabase().from('reminders').insert({
        task_id: task.id,
        user_id: userId,
        reminder_time: reminderTime,
      });
    }
  }
}

/** Sync Google Calendar events → tasks for a user */
export async function syncCalendar(userId: string): Promise<{ synced: number }> {
  const calendar = await getAuthenticatedCalendar(userId);

  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: twoWeeksLater.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  const events = response.data.items || [];
  const categoryId = await getOrCreateMeetingsCategory(userId);

  // Track event IDs from Google
  const googleEventIds = new Set<string>();

  for (const event of events) {
    if (event.id) googleEventIds.add(event.id);
    await upsertEventAsTask(userId, categoryId, event);
  }

  // Mark tasks for events that no longer exist as completed
  if (googleEventIds.size > 0) {
    const { data: orphanedTasks } = await getSupabase()
      .from('tasks')
      .select('id, google_event_id')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .not('google_event_id', 'is', null)
      .neq('status', 'completed');

    if (orphanedTasks) {
      for (const task of orphanedTasks) {
        if (task.google_event_id && !googleEventIds.has(task.google_event_id)) {
          // Event was deleted/moved outside sync window — mark completed
          await getSupabase()
            .from('tasks')
            .update({ status: 'completed' })
            .eq('id', task.id);
        }
      }
    }
  }

  console.log(`[CALENDAR] Synced ${events.length} events for user ${userId}`);
  return { synced: events.length };
}

/** Register a Google Calendar push notification watch channel for a user */
export async function watchCalendar(userId: string): Promise<void> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.warn('[CALENDAR] GOOGLE_WEBHOOK_URL not set — skipping watch registration');
    return;
  }

  const calendar = await getAuthenticatedCalendar(userId);
  const channelId = `todo-ai-${userId}-${Date.now()}`;
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  try {
    const res = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        expiration: expiration.toString(),
        params: { ttl: '604800' }, // 7 days in seconds
      },
    });

    await getSupabase()
      .from('users')
      .update({
        google_watch_channel_id: channelId,
        google_watch_resource_id: res.data.resourceId || null,
        google_watch_expiry: new Date(expiration).toISOString(),
      })
      .eq('id', userId);

    console.log(`[CALENDAR] Watch registered for user ${userId}, channel=${channelId}`);
  } catch (err: any) {
    // Non-fatal — polling cron will still work
    console.warn(`[CALENDAR] Watch registration failed for user ${userId}:`, err.message);
  }
}

/** Stop an existing watch channel */
export async function stopWatch(userId: string): Promise<void> {
  const { data: user } = await getSupabase()
    .from('users')
    .select('google_watch_channel_id, google_watch_resource_id')
    .eq('id', userId)
    .single();

  if (!user?.google_watch_channel_id || !user?.google_watch_resource_id) return;

  try {
    const calendar = await getAuthenticatedCalendar(userId);
    await calendar.channels.stop({
      requestBody: {
        id: user.google_watch_channel_id,
        resourceId: user.google_watch_resource_id,
      },
    });
    console.log(`[CALENDAR] Watch stopped for user ${userId}`);
  } catch (err: any) {
    console.warn(`[CALENDAR] stopWatch error for user ${userId}:`, err.message);
  }

  await getSupabase()
    .from('users')
    .update({ google_watch_channel_id: null, google_watch_resource_id: null, google_watch_expiry: null })
    .eq('id', userId);
}

/** Renew watch channels that are expiring within the next 24 hours */
export async function renewWatches(): Promise<void> {
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: users } = await getSupabase()
    .from('users')
    .select('id')
    .eq('google_calendar_connected', true)
    .not('google_watch_channel_id', 'is', null)
    .lte('google_watch_expiry', cutoff);

  if (!users?.length) return;

  console.log(`[CALENDAR] Renewing ${users.length} expiring watch channel(s)`);
  for (const user of users) {
    await stopWatch(user.id);
    await watchCalendar(user.id);
    // Stagger to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Find user by their watch channel ID (for webhook processing) */
export async function findUserByWatchChannel(channelId: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('users')
    .select('id')
    .eq('google_watch_channel_id', channelId)
    .single();

  return data?.id || null;
}

/** Get the webhook URL from env */
function getWebhookUrl(): string | null {
  return process.env.GOOGLE_WEBHOOK_URL || null;
}
