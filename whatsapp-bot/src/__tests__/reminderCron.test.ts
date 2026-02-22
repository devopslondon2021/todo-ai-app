import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockSchedule = vi.fn();
vi.mock('node-cron', () => ({ default: { schedule: (...args: any[]) => mockSchedule(...args) } }));

vi.mock('../config/env.js', () => ({
  env: { CALL_ESCALATION_DELAY_MIN: 5 },
}));

const mockSupabaseFrom = vi.fn();
vi.mock('../config/supabase.js', () => ({
  getSupabase: () => ({ from: mockSupabaseFrom }),
}));

const mockSendMessage = vi.fn().mockResolvedValue({ key: { id: 'msg-1' } });
vi.mock('../connection/whatsapp.js', () => ({
  getSocket: () => ({ sendMessage: mockSendMessage }),
}));

const mockIsEnabled = vi.fn(() => false);
const mockMakeCall = vi.fn().mockResolvedValue(true);
vi.mock('../services/callService.js', () => ({
  isCallEscalationEnabled: () => mockIsEnabled(),
  makeReminderCall: (...args: any[]) => mockMakeCall(...args),
}));

const mockGetCandidates = vi.fn().mockResolvedValue([]);
const mockMarkEscalated = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/taskService.js', () => ({
  getEscalationCandidates: (...args: any[]) => mockGetCandidates(...args),
  markCallEscalated: (...args: any[]) => mockMarkEscalated(...args),
}));

import { startReminderScheduler } from '../scheduler/reminderCron.js';

// Helper: run the cron callback
function getCronCallback(): () => Promise<void> {
  startReminderScheduler();
  return mockSchedule.mock.calls[0][1];
}

// Chain builder for Supabase mock queries
function mockQuery(data: any[] | null, error: any = null) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'lte', 'gte', 'limit', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal — return data
  chain.limit = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('reminderCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedule.mockReset();
  });

  it('registers a cron job on "* * * * *"', () => {
    startReminderScheduler();
    expect(mockSchedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
  });

  describe('pass 1 — WhatsApp text reminders', () => {
    it('sends individual WhatsApp messages per reminder', async () => {
      const chain = mockQuery([
        {
          id: 'rem-1',
          reminder_time: new Date().toISOString(),
          tasks: { title: 'Buy milk', description: null, priority: 'medium', due_date: null, status: 'pending' },
          users: { whatsapp_jid: '1234@s.whatsapp.net' },
        },
        {
          id: 'rem-2',
          reminder_time: new Date().toISOString(),
          tasks: { title: 'Call dentist', description: 'Annual checkup', priority: 'high', due_date: '2026-02-22T10:00:00Z', status: 'pending' },
          users: { whatsapp_jid: '1234@s.whatsapp.net' },
        },
      ]);
      mockSupabaseFrom.mockReturnValue(chain);

      const tick = getCronCallback();
      await tick();

      // Each reminder should trigger its own message (not batched)
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '1234@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Buy milk') })
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        '1234@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Call dentist') })
      );
    });

    it('skips completed tasks and does not send messages for them', async () => {
      const updateChain: any = { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) };
      const chain = mockQuery([
        {
          id: 'rem-1',
          reminder_time: new Date().toISOString(),
          tasks: { title: 'Done task', description: null, priority: 'low', due_date: null, status: 'completed' },
          users: { whatsapp_jid: '5555@s.whatsapp.net' },
        },
      ]);

      let callCount = 0;
      mockSupabaseFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain; // SELECT
        return { update: vi.fn().mockReturnValue(updateChain) }; // UPDATE (mark completed reminder as sent)
      });

      const tick = getCronCallback();
      await tick();

      // Should NOT send a WhatsApp message
      expect(mockSendMessage).not.toHaveBeenCalled();
      // But should still mark the reminder as sent
      expect(mockSupabaseFrom).toHaveBeenCalledTimes(2);
    });

    it('marks reminders as sent after sending', async () => {
      const updateChain: any = { eq: vi.fn().mockResolvedValue({}) };
      const chain = mockQuery([
        {
          id: 'rem-1',
          reminder_time: new Date().toISOString(),
          tasks: { title: 'Test', description: null, priority: 'low', due_date: null, status: 'pending' },
          users: { whatsapp_jid: '5555@s.whatsapp.net' },
        },
      ]);

      let callCount = 0;
      mockSupabaseFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain; // SELECT
        return { update: vi.fn().mockReturnValue(updateChain) }; // UPDATE
      });

      const tick = getCronCallback();
      await tick();

      // The update should have been called
      expect(mockSupabaseFrom).toHaveBeenCalledTimes(2);
    });
  });

  describe('pass 2 — call escalation', () => {
    it('does not run when call escalation is disabled', async () => {
      mockIsEnabled.mockReturnValue(false);
      const chain = mockQuery([]);
      mockSupabaseFrom.mockReturnValue(chain);

      const tick = getCronCallback();
      await tick();

      expect(mockGetCandidates).not.toHaveBeenCalled();
      expect(mockMakeCall).not.toHaveBeenCalled();
    });

    it('calls users for unacknowledged reminders when enabled', async () => {
      mockIsEnabled.mockReturnValue(true);
      const chain = mockQuery([]);
      mockSupabaseFrom.mockReturnValue(chain);

      mockGetCandidates.mockResolvedValue([
        {
          id: 'rem-2',
          tasks: { title: 'Urgent task' },
          users: { whatsapp_jid: '919876543210@s.whatsapp.net' },
        },
      ]);

      const tick = getCronCallback();
      await tick();

      expect(mockGetCandidates).toHaveBeenCalledWith(5);
      expect(mockMakeCall).toHaveBeenCalledWith('919876543210', 'Urgent task');
      expect(mockMarkEscalated).toHaveBeenCalledWith('rem-2');
    });

    it('sends a WhatsApp notification before calling', async () => {
      mockIsEnabled.mockReturnValue(true);
      const chain = mockQuery([]);
      mockSupabaseFrom.mockReturnValue(chain);

      mockGetCandidates.mockResolvedValue([
        {
          id: 'rem-3',
          tasks: { title: 'Call test' },
          users: { whatsapp_jid: '5551234567@s.whatsapp.net' },
        },
      ]);

      const tick = getCronCallback();
      await tick();

      // Should send WhatsApp "calling you" message
      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Calling you about') })
      );
    });

    it('skips candidates with invalid JID', async () => {
      mockIsEnabled.mockReturnValue(true);
      const chain = mockQuery([]);
      mockSupabaseFrom.mockReturnValue(chain);

      mockGetCandidates.mockResolvedValue([
        { id: 'rem-4', tasks: { title: 'No user' }, users: null },
      ]);

      const tick = getCronCallback();
      await tick();

      expect(mockMakeCall).not.toHaveBeenCalled();
    });
  });
});
