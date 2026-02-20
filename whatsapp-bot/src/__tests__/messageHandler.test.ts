import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the handler
vi.mock('../services/taskService.js', () => ({
  getOrCreateUser: vi.fn(),
  createTaskFromParsed: vi.fn(),
  findDuplicates: vi.fn(),
  getRecentTasks: vi.fn(),
  getTasksForWhatsApp: vi.fn(),
  markComplete: vi.fn(),
  deleteTask: vi.fn(),
  getCategories: vi.fn(),
  getCategoryTree: vi.fn(),
}));

vi.mock('../services/aiService.js', () => ({
  parseNaturalLanguage: vi.fn(),
}));

vi.mock('../connection/whatsapp.js', () => ({
  trackSentMessage: vi.fn(),
  storeSentMessage: vi.fn(),
  getMyPhoneJid: vi.fn(() => null),
}));

import { handleMessage } from '../handlers/messageHandler.js';
import * as taskService from '../services/taskService.js';
import * as aiService from '../services/aiService.js';

// Helper to create a mock WASocket
function mockSocket() {
  return { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'sent-msg-1' } }) } as any;
}

// Helper to create a mock WhatsApp message
function mockMsg(text: string, jid = '1234567890@s.whatsapp.net', fromMe = false) {
  return {
    key: { remoteJid: jid, fromMe },
    message: { conversation: text },
  } as any;
}

const MOCK_USER = { id: 'user-1', whatsapp_jid: '1234567890@s.whatsapp.net', name: '1234567890' };

const MOCK_TASK = {
  id: 'task-1',
  title: 'Buy milk',
  priority: 'medium',
  status: 'pending',
  due_date: new Date().toISOString(),
  reminder_time: null,
  categories: { name: 'Personal' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(taskService.getOrCreateUser).mockResolvedValue(MOCK_USER);
  vi.mocked(taskService.findDuplicates).mockResolvedValue([]);
  vi.mocked(taskService.getCategories).mockResolvedValue([]);
});

describe('handleMessage', () => {
  // ─── FILTERS ───
  // Note: group/status/fromMe filtering is handled in the connection layer (whatsapp.ts),
  // not in the message handler. These tests cover what messageHandler itself filters.
  describe('message filtering', () => {
    it('ignores messages without remoteJid', async () => {
      const sock = mockSocket();
      const msg = { key: { remoteJid: null }, message: { conversation: 'hello' } } as any;
      await handleMessage(sock, msg);
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it('ignores empty messages', async () => {
      const sock = mockSocket();
      const msg = mockMsg('', '1234@s.whatsapp.net');
      await handleMessage(sock, msg);
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it('ignores whitespace-only messages', async () => {
      const sock = mockSocket();
      const msg = mockMsg('   ', '1234@s.whatsapp.net');
      await handleMessage(sock, msg);
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it('processes 1:1 messages', async () => {
      const sock = mockSocket();
      const msg = mockMsg('help', '1234@s.whatsapp.net', false);
      await handleMessage(sock, msg);
      expect(sock.sendMessage).toHaveBeenCalled();
    });
  });

  // ─── HELP ───
  describe('help command', () => {
    it('sends help text', async () => {
      const sock = mockSocket();
      await handleMessage(sock, mockMsg('help'));
      expect(sock.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Todo AI Bot') })
      );
    });
  });

  // ─── ADD / NATURAL LANGUAGE ───
  describe('task creation (add/natural)', () => {
    const PARSED = {
      title: 'Buy milk',
      description: null,
      priority: 'medium' as const,
      category: 'Personal',
      subcategory: null,
      due_date: '2026-02-21T17:00:00.000Z',
      reminder_time: '2026-02-21T16:30:00.000Z',
      is_recurring: false,
      recurrence_rule: null,
    };

    it('creates a task from "add buy milk"', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('buy milk');
      expect(taskService.createTaskFromParsed).toHaveBeenCalledWith('user-1', PARSED);
      expect(sock.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Task created') })
      );
    });

    it('creates a task from natural language', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('buy groceries tomorrow at 5pm'));

      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('buy groceries tomorrow at 5pm');
      expect(taskService.createTaskFromParsed).toHaveBeenCalled();
    });

    it('prefixes "remind me to" for remind command', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('remind call mom'));

      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('remind me to call mom');
    });

    it('shows priority in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue({ ...PARSED, priority: 'high' });
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue({ ...MOCK_TASK, priority: 'high' });

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add urgent task'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('High');
    });

    it('shows category in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Personal');
    });

    it('shows due date in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Due:');
    });

    it('shows reminder time when present', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue({
        ...MOCK_TASK,
        reminder_time: '2026-02-21T16:30:00.000Z',
      });

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Reminder:');
    });
  });

  // ─── DUPLICATE DETECTION ───
  describe('duplicate detection', () => {
    const PARSED = {
      title: 'Buy milk',
      description: null,
      priority: 'medium' as const,
      category: null,
      subcategory: null,
      due_date: null,
      reminder_time: null,
      is_recurring: false,
      recurrence_rule: null,
    };

    it('asks for confirmation when duplicates found', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Buy milk and eggs', similarity_score: 0.75 },
      ]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Similar task(s) found');
      expect(reply).toContain('Buy milk and eggs');
      expect(reply).toContain('75%');
      expect(reply).toContain('yes');
      expect(reply).toContain('no');
      // Task should NOT be created yet
      expect(taskService.createTaskFromParsed).not.toHaveBeenCalled();
    });

    it('creates task on "yes" confirmation', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Buy milk and eggs', similarity_score: 0.75 },
      ]);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      const jid = '1234567890@s.whatsapp.net';

      // First message triggers duplicate detection
      await handleMessage(sock, mockMsg('add buy milk'));

      // Second message confirms
      await handleMessage(sock, mockMsg('yes'));

      expect(taskService.createTaskFromParsed).toHaveBeenCalledWith('user-1', PARSED);
      // The confirmation reply should contain "Task created"
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Task created');
    });

    it('cancels task on "no" response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Buy milk and eggs', similarity_score: 0.75 },
      ]);

      const sock = mockSocket();

      await handleMessage(sock, mockMsg('add buy milk'));
      await handleMessage(sock, mockMsg('no'));

      expect(taskService.createTaskFromParsed).not.toHaveBeenCalled();
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('cancelled');
    });

    it('accepts "y" as confirmation', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Similar', similarity_score: 0.5 },
      ]);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await handleMessage(sock, mockMsg('y'));

      expect(taskService.createTaskFromParsed).toHaveBeenCalled();
    });

    it('accepts "n" as rejection', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Similar', similarity_score: 0.5 },
      ]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await handleMessage(sock, mockMsg('n'));

      expect(taskService.createTaskFromParsed).not.toHaveBeenCalled();
    });

    it('clears pending and processes new command on non-yes/no response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates)
        .mockResolvedValueOnce([{ id: 'dup-1', title: 'Similar', similarity_score: 0.5 }])
        .mockResolvedValue([]); // No duplicates for the new command
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      // Instead of yes/no, send a new command
      await handleMessage(sock, mockMsg('help'));

      // Should show help, not create the pending task
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Todo AI Bot');
    });
  });

  // ─── LIST ───
  describe('list command', () => {
    it('lists pending tasks', async () => {
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('list'));

      expect(taskService.getTasksForWhatsApp).toHaveBeenCalledWith('user-1', undefined);
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Your Tasks');
      expect(reply).toContain('Buy milk');
    });

    it('lists tasks with filter', async () => {
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('list today'));

      expect(taskService.getTasksForWhatsApp).toHaveBeenCalledWith('user-1', 'today');
    });

    it('shows empty list message', async () => {
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('list'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('No tasks found');
    });
  });

  // ─── DONE ───
  describe('done command', () => {
    it('marks task as complete by number', async () => {
      vi.mocked(taskService.getRecentTasks).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('done 1'));

      expect(taskService.markComplete).toHaveBeenCalledWith('task-1');
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Completed');
      expect(reply).toContain('Buy milk');
    });

    it('shows error for invalid task number', async () => {
      vi.mocked(taskService.getRecentTasks).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('done 5'));

      expect(taskService.markComplete).not.toHaveBeenCalled();
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('not found');
    });

    it('uses 1-based indexing', async () => {
      const tasks = [
        { ...MOCK_TASK, id: 'task-1', title: 'First' },
        { ...MOCK_TASK, id: 'task-2', title: 'Second' },
      ];
      vi.mocked(taskService.getRecentTasks).mockResolvedValue(tasks);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('done 2'));

      expect(taskService.markComplete).toHaveBeenCalledWith('task-2');
    });
  });

  // ─── DELETE ───
  describe('delete command', () => {
    it('deletes task by number', async () => {
      vi.mocked(taskService.getRecentTasks).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('delete 1'));

      expect(taskService.deleteTask).toHaveBeenCalledWith('task-1');
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Deleted');
      expect(reply).toContain('Buy milk');
    });

    it('works with "remove" alias', async () => {
      vi.mocked(taskService.getRecentTasks).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('remove 1'));

      expect(taskService.deleteTask).toHaveBeenCalledWith('task-1');
    });

    it('shows error for invalid task number', async () => {
      vi.mocked(taskService.getRecentTasks).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('delete 1'));

      expect(taskService.deleteTask).not.toHaveBeenCalled();
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('not found');
    });
  });

  // ─── CATEGORIES ───
  describe('categories command', () => {
    it('shows category tree', async () => {
      vi.mocked(taskService.getCategoryTree).mockResolvedValue([
        { id: '1', name: 'Personal', children: [] },
        { id: '2', name: 'Work', children: [] },
      ]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('categories'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Personal');
      expect(reply).toContain('Work');
    });

    it('shows empty message when no categories', async () => {
      vi.mocked(taskService.getCategoryTree).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('categories'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('No categories');
    });

    it('works with "cats" shorthand', async () => {
      vi.mocked(taskService.getCategoryTree).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('cats'));

      expect(taskService.getCategoryTree).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── ERROR HANDLING ───
  describe('error handling', () => {
    it('sends error message on service failure', async () => {
      vi.mocked(taskService.getOrCreateUser).mockRejectedValue(new Error('DB error'));

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('help'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Something went wrong');
    });

    it('sends error message on AI failure', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockRejectedValue(new Error('AI down'));

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Something went wrong');
    });
  });

  // ─── EXTENDED TEXT MESSAGES ───
  describe('extended text messages', () => {
    it('handles extendedTextMessage format', async () => {
      const sock = mockSocket();
      const msg = {
        key: { remoteJid: '1234567890@s.whatsapp.net', fromMe: false },
        message: { extendedTextMessage: { text: 'help' } },
      } as any;

      await handleMessage(sock, msg);

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        expect.objectContaining({ text: expect.stringContaining('Todo AI Bot') })
      );
    });
  });
});
