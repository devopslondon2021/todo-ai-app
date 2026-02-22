import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing callService
vi.mock('../config/env.js', () => ({
  env: {
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_PHONE_NUMBER: '',
    CALL_ESCALATION_DELAY_MIN: 5,
  },
}));

// Mock the module (createRequire) so twilio is never actually loaded
const mockCallsCreate = vi.fn();
vi.mock('module', () => ({
  createRequire: () => (mod: string) => {
    if (mod === 'twilio') {
      return () => ({ calls: { create: mockCallsCreate } });
    }
    throw new Error(`Unexpected require: ${mod}`);
  },
}));

import { isCallEscalationEnabled, makeReminderCall } from '../services/callService.js';
import { env } from '../config/env.js';

describe('callService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to disabled
    (env as any).TWILIO_ACCOUNT_SID = '';
    (env as any).TWILIO_AUTH_TOKEN = '';
    (env as any).TWILIO_PHONE_NUMBER = '';
  });

  describe('isCallEscalationEnabled', () => {
    it('returns false when env vars are empty', () => {
      expect(isCallEscalationEnabled()).toBe(false);
    });

    it('returns false when only some vars are set', () => {
      (env as any).TWILIO_ACCOUNT_SID = 'ACtest';
      (env as any).TWILIO_AUTH_TOKEN = 'token';
      // TWILIO_PHONE_NUMBER still empty
      expect(isCallEscalationEnabled()).toBe(false);
    });

    it('returns true when all 3 vars are set', () => {
      (env as any).TWILIO_ACCOUNT_SID = 'ACtest';
      (env as any).TWILIO_AUTH_TOKEN = 'token';
      (env as any).TWILIO_PHONE_NUMBER = '+15551234567';
      expect(isCallEscalationEnabled()).toBe(true);
    });
  });

  describe('makeReminderCall', () => {
    it('no-ops and returns false when disabled', async () => {
      const result = await makeReminderCall('1234567890', 'Buy milk');
      expect(result).toBe(false);
      expect(mockCallsCreate).not.toHaveBeenCalled();
    });

    it('creates a call with correct TwiML when enabled', async () => {
      (env as any).TWILIO_ACCOUNT_SID = 'ACtest';
      (env as any).TWILIO_AUTH_TOKEN = 'token';
      (env as any).TWILIO_PHONE_NUMBER = '+15551234567';
      mockCallsCreate.mockResolvedValue({ sid: 'CA123' });

      const result = await makeReminderCall('919876543210', 'Buy milk');

      expect(result).toBe(true);
      expect(mockCallsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+919876543210',
          from: '+15551234567',
          timeout: 20,
          twiml: expect.stringContaining('Buy milk'),
        })
      );
    });

    it('sanitizes special characters in task title', async () => {
      (env as any).TWILIO_ACCOUNT_SID = 'ACtest';
      (env as any).TWILIO_AUTH_TOKEN = 'token';
      (env as any).TWILIO_PHONE_NUMBER = '+15551234567';
      mockCallsCreate.mockResolvedValue({ sid: 'CA123' });

      await makeReminderCall('1234567890', 'Fix <script> & "quotes"');

      const twiml = mockCallsCreate.mock.calls[0][0].twiml;
      expect(twiml).not.toContain('<script>');
      expect(twiml).not.toContain('&');
      expect(twiml).not.toContain('"quotes"');
    });

    it('returns false and does not throw on Twilio error', async () => {
      (env as any).TWILIO_ACCOUNT_SID = 'ACtest';
      (env as any).TWILIO_AUTH_TOKEN = 'token';
      (env as any).TWILIO_PHONE_NUMBER = '+15551234567';
      mockCallsCreate.mockRejectedValue(new Error('Twilio error'));

      const result = await makeReminderCall('1234567890', 'Buy milk');
      expect(result).toBe(false);
    });
  });
});
