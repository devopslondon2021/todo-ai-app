import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { env } from '../config/env.js';

export function startCalendarSyncScheduler(): void {
  // Sync every 15 minutes — safety net for missed webhooks
  cron.schedule('*/15 * * * *', async () => {
    try {
      // Only sync users who have calendar connected AND have Google credentials stored
      const { data: users, error } = await getSupabase()
        .from('users')
        .select('id')
        .eq('google_calendar_connected', true)
        .not('google_client_id', 'is', null)
        .not('google_client_secret', 'is', null);

      if (error || !users?.length) return;

      console.log(`[CAL-SYNC] Syncing ${users.length} user(s)...`);

      for (const user of users) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25_000);
          const res = await fetch(`${env.BACKEND_URL}/api/calendar/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.id }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn(`[CAL-SYNC] Sync failed for user ${user.id}: ${res.status} ${body.slice(0, 100)}`);
          }
        } catch (err: any) {
          console.warn(`[CAL-SYNC] Sync error for user ${user.id}:`, err.message);
        }
        // Stagger 2s between users to avoid Google API rate limits
        if (users.length > 1) await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error('[CAL-SYNC] Cron error:', err);
    }
  });

  console.log('📅 Calendar sync scheduler started (every 15 min)\n');
}
