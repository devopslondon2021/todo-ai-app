import { createRequire } from 'module';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);

let twilioClient: any = null;

/** Check if all 3 Twilio env vars are set */
export function isCallEscalationEnabled(): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}

/** Lazily initialize the Twilio client */
function getClient() {
  if (!twilioClient) {
    const twilio = require('twilio');
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

/**
 * Make a reminder phone call via Twilio.
 * No-ops if Twilio is not configured. Never throws.
 */
export async function makeReminderCall(phoneNumber: string, taskTitle: string): Promise<boolean> {
  if (!isCallEscalationEnabled()) return false;

  try {
    const client = getClient();

    // Sanitize task title for TwiML
    const safeTitle = taskTitle.replace(/[&<>"']/g, '');

    const call = await client.calls.create({
      twiml: `<Response><Say voice="alice">Reminder from Todo AI: ${safeTitle}. Please check your WhatsApp messages.</Say><Pause length="1"/><Say voice="alice">Again: ${safeTitle}</Say></Response>`,
      to: `+${phoneNumber}`,
      from: env.TWILIO_PHONE_NUMBER,
      timeout: 20,
    });

    console.log(`[CALL] Call initiated: sid=${call.sid} to=+${phoneNumber} task="${taskTitle}"`);
    return true;
  } catch (err) {
    console.error(`[CALL] Failed to call +${phoneNumber}:`, err);
    return false;
  }
}
