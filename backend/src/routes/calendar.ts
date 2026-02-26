import { Router, Request, Response } from 'express';
import * as calendarService from '../services/calendarService';

const router = Router();

/** POST /api/calendar/credentials — save Google OAuth client ID + secret to DB */
router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { user_id, client_id, client_secret } = req.body;
    if (!user_id || !client_id || !client_secret) {
      return res.status(400).json({ error: 'user_id, client_id, and client_secret are required' });
    }

    // Basic format validation
    if (!client_id.includes('.apps.googleusercontent.com')) {
      return res.status(400).json({ error: 'Invalid Client ID format. It should end with .apps.googleusercontent.com' });
    }

    await calendarService.saveCredentials(user_id, client_id.trim(), client_secret.trim());
    res.json({ data: { saved: true } });
  } catch (err: any) {
    console.error('[CALENDAR] credentials save error:', err);
    res.status(500).json({ error: err.message || 'Failed to save credentials' });
  }
});

/** GET /api/calendar/auth-url?user_id=xxx — returns Google OAuth URL */
router.get('/auth-url', async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const url = await calendarService.getAuthUrl(userId);
    res.json({ data: { url } });
  } catch (err: any) {
    if (err.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'NOT_CONFIGURED' });
    }
    console.error('[CALENDAR] auth-url error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate auth URL' });
  }
});

/** POST /api/calendar/connect — exchange auth code for tokens + initial sync */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const { code, user_id } = req.body;
    if (!code || !user_id) {
      return res.status(400).json({ error: 'code and user_id are required' });
    }

    await calendarService.handleCallback(code, user_id);
    res.json({ data: { connected: true } });
  } catch (err: any) {
    console.error('[CALENDAR] connect error:', err);
    res.status(500).json({ error: err.message || 'Failed to connect Google Calendar' });
  }
});

/** POST /api/calendar/sync — trigger manual sync */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await calendarService.syncCalendar(user_id);
    res.json({ data: result });
  } catch (err: any) {
    console.error('[CALENDAR] sync error:', err);
    res.status(500).json({ error: err.message || 'Failed to sync calendar' });
  }
});

/** GET /api/calendar/status?user_id=xxx — check connection status + configuration */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const configured = await calendarService.isConfigured(userId);
    if (!configured) {
      return res.json({ data: { connected: false, configured: false } });
    }

    const status = await calendarService.getStatus(userId);
    res.json({ data: { ...status, configured: true } });
  } catch (err: any) {
    console.error('[CALENDAR] status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get status' });
  }
});

/** POST /api/calendar/check-availability — check if a time slot is free */
router.post('/check-availability', async (req: Request, res: Response) => {
  try {
    const { user_id, start, end } = req.body;
    if (!user_id || !start || !end) {
      return res.status(400).json({ error: 'user_id, start, and end are required' });
    }

    const result = await calendarService.checkAvailability(user_id, start, end);
    res.json({ data: result });
  } catch (err: any) {
    if (err.message === 'SCOPE_UPGRADE_NEEDED') {
      return res.status(403).json({ error: 'SCOPE_UPGRADE_NEEDED' });
    }
    console.error('[CALENDAR] check-availability error:', err);
    res.status(500).json({ error: err.message || 'Failed to check availability' });
  }
});

/** POST /api/calendar/events — create a calendar event */
router.post('/events', async (req: Request, res: Response) => {
  try {
    const { user_id, summary, description, start, duration_minutes, attendee_names } = req.body;
    if (!user_id || !summary || !start) {
      return res.status(400).json({ error: 'user_id, summary, and start are required' });
    }

    const result = await calendarService.createEvent(user_id, {
      summary,
      description,
      start,
      duration_minutes,
      attendee_names,
    });
    res.json({ data: result });
  } catch (err: any) {
    if (err.message === 'SCOPE_UPGRADE_NEEDED') {
      return res.status(403).json({ error: 'SCOPE_UPGRADE_NEEDED' });
    }
    const errDetail = err.response?.data?.error?.message || err.message || 'Failed to create event';
    console.error('[CALENDAR] create event error:', errDetail, err.code || '', err.status || '');
    res.status(500).json({ error: errDetail });
  }
});

/** POST /api/calendar/webhook — receive Google Calendar push notifications */
router.post('/webhook', async (req: Request, res: Response) => {
  // Google sends a sync message on channel creation — respond 200 immediately
  const channelId = req.headers['x-goog-channel-id'] as string;
  const resourceState = req.headers['x-goog-resource-state'] as string;

  // Always respond 200 quickly to avoid Google retries
  res.status(200).send('OK');

  if (!channelId || resourceState === 'sync') return;

  try {
    const userId = await calendarService.findUserByWatchChannel(channelId);
    if (!userId) {
      console.warn(`[WEBHOOK] Unknown channel ${channelId}`);
      return;
    }

    console.log(`[WEBHOOK] Calendar change for user ${userId} (state=${resourceState})`);
    await calendarService.syncCalendar(userId);
  } catch (err: any) {
    console.error('[WEBHOOK] Sync error:', err.message);
  }
});

/** DELETE /api/calendar/disconnect — remove Google Calendar connection */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    await calendarService.disconnect(userId);
    res.json({ data: { connected: false } });
  } catch (err: any) {
    console.error('[CALENDAR] disconnect error:', err);
    res.status(500).json({ error: err.message || 'Failed to disconnect' });
  }
});

export default router;
