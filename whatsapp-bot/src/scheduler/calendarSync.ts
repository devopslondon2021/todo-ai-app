import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { env } from '../config/env.js';

export function startCalendarSyncScheduler(): void {
  // Sync every 15 minutes — safety net for missed webhooks
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { data: users, error } = await getSupabase()
        .from('users')
        .select('id')
        .eq('google_calendar_connected', true);

      if (error || !users?.length) return;

      console.log(`[CAL-SYNC] Syncing ${users.length} user(s)...`);

      for (const user of users) {
        try {
          const res = await fetch(`${env.BACKEND_URL}/api/calendar/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.id }),
          });
          if (!res.ok) {
            console.warn(`[CAL-SYNC] Sync failed for user ${user.id}: ${res.status}`);
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
