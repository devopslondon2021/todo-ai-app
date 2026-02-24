import { google, calendar_v3 } from 'googleapis';
import { getSupabase } from '../config/supabase';

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

    // If column doesn't exist (migration_v8 not run), error will be set — fall through to .env
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

  return null;
}

/** Check if Google Calendar credentials are configured (DB or .env) */
export async function isConfigured(userId?: string): Promise<boolean> {
  const creds = await getGoogleCredentials(userId);
  return creds !== null;
}

function getOAuth2Client(creds: GoogleCreds) {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
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

  // Initial sync
  await syncCalendar(userId);
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

/** Disconnect Google Calendar — clear tokens */
export async function disconnect(userId: string): Promise<void> {
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

  oauth2Client.on('tokens', async (tokens) => {
    const updates: Record<string, any> = {};
    if (tokens.access_token) updates.google_access_token = tokens.access_token;
    if (tokens.expiry_date) updates.google_token_expiry = new Date(tokens.expiry_date).toISOString();
    if (tokens.refresh_token) updates.google_refresh_token = tokens.refresh_token;
    if (Object.keys(updates).length > 0) {
      await getSupabase().from('users').update(updates).eq('id', userId);
    }
  });

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
    const durationMs = (opts.duration_minutes || 30) * 60 * 1000;
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

/** Build description with meeting link + attendees */
function buildDescription(event: calendar_v3.Schema$Event): string {
  const parts: string[] = [];

  const link = getMeetingLink(event);
  if (link) parts.push(link);

  if (event.location && !event.location.startsWith('http')) {
    parts.push(`Location: ${event.location}`);
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
  const description = buildDescription(event);
  const dueDate = new Date(startTime).toISOString();

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
    const { data: task, error } = await getSupabase()
      .from('tasks')
      .insert({
        user_id: userId,
        category_id: categoryId,
        title,
        description,
        priority: 'medium',
        status: 'pending',
        due_date: dueDate,
        reminder_time: reminderTime,
        google_event_id: event.id,
      })
      .select('id')
      .single();

    if (error) {
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
