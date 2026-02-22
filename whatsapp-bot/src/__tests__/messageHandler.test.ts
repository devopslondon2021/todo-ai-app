import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the handler
vi.mock('../services/taskService.js', () => ({
  getOrCreateUser: vi.fn(),
  createTask: vi.fn(),
  createTaskFromParsed: vi.fn(),
  findDuplicates: vi.fn(),
  resolveCategoryPath: vi.fn().mockResolvedValue(undefined),
  getRecentTasks: vi.fn(),
  getTasksForWhatsApp: vi.fn(),
  markComplete: vi.fn(),
  deleteTask: vi.fn(),
  getCategories: vi.fn(),
  getCategoryTree: vi.fn(),
  getTaskStats: vi.fn(),
  getUpcomingReminders: vi.fn(),
  acknowledgeReminders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/aiService.js', () => ({
  parseNaturalLanguage: vi.fn(),
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'unknown' }),
}));

vi.mock('../connection/whatsapp.js', () => ({
  trackSentMessage: vi.fn(),
  storeSentMessage: vi.fn(),
  getMyPhoneJid: vi.fn(() => null),
}));

vi.mock('../services/callService.js', () => ({
  isCallEscalationEnabled: vi.fn(() => false),
}));

vi.mock('../services/transcriptionService.js', () => ({
  transcribeVoiceMessage: vi.fn(),
}));

vi.mock('../services/videoService.js', () => ({
  fetchVideoMetadata: vi.fn().mockResolvedValue('Test Video Title'),
  saveVideo: vi.fn().mockResolvedValue({ id: 'vid-1', title: '[YT] YouTube Video (abc123)' }),
  enrichVideoTitle: vi.fn().mockResolvedValue(undefined),
  getVideos: vi.fn().mockResolvedValue([]),
  markVideoWatched: vi.fn().mockResolvedValue(undefined),
  getVideoParentCategoryId: vi.fn().mockResolvedValue(null),
  getAllVideoCategoryIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../config/env.js', () => ({
  env: { AI_PROVIDER: 'openai' },
}));

import { handleMessage } from '../handlers/messageHandler.js';
import * as taskService from '../services/taskService.js';
import * as aiService from '../services/aiService.js';
import * as videoService from '../services/videoService.js';
import { transcribeVoiceMessage } from '../services/transcriptionService.js';
import { env } from '../config/env.js';

// Helper to create a mock WASocket
function mockSocket() {
  return { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'sent-msg-1' } }) } as any;
}

// Helper to create a mock WhatsApp message
function mockMsg(text: string, jid = '1234567890@s.whatsapp.net', fromMe = false) {
  return {
    key: { remoteJid: jid, fromMe },
    pushName: 'Test User',
    message: { conversation: text },
  } as any;
}

// Helper to create a mock voice note message
function mockVoiceNote(jid = '1234567890@s.whatsapp.net', ptt = true) {
  return {
    key: { remoteJid: jid, fromMe: false },
    message: { audioMessage: { ptt, mimetype: 'audio/ogg; codecs=opus' } },
  } as any;
}

/** Wait for fire-and-forget background processing to complete */
const flush = () => new Promise(r => setTimeout(r, 50));

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
  vi.mocked(taskService.resolveCategoryPath).mockResolvedValue(undefined);
  vi.mocked(taskService.acknowledgeReminders).mockResolvedValue(undefined);
  (env as any).AI_PROVIDER = 'openai';
});

describe('handleMessage', () => {
  // ─── FILTERS ───
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

  // ─── ADD ───
  // Note: processAddInBackground is fire-and-forget, so we flush() to let it complete
  describe('task creation (add/remind)', () => {
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
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('buy milk', []);
      expect(taskService.createTask).toHaveBeenCalled();
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Buy milk');
      expect(lastReply).toContain('added');
    });

    it('classifies unknown text via AI and shows error for unknown intent', async () => {
      vi.mocked(aiService.classifyIntent).mockResolvedValue({ intent: 'unknown' });

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('buy groceries tomorrow at 5pm'));

      expect(aiService.classifyIntent).toHaveBeenCalledWith('buy groceries tomorrow at 5pm');
      expect(aiService.parseNaturalLanguage).not.toHaveBeenCalled();
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain("didn't understand");
    });

    it('routes AI-classified add intent to task creation', async () => {
      vi.mocked(aiService.classifyIntent).mockResolvedValue({ intent: 'add', text: 'buy groceries tomorrow' });
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue({
        title: 'Buy groceries',
        description: null,
        priority: 'medium' as const,
        category: 'Personal',
        subcategory: null,
        due_date: '2026-02-22T17:00:00.000Z',
        reminder_time: null,
        is_recurring: false,
        recurrence_rule: null,
      });
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('please add buy groceries tomorrow'));
      await flush();

      expect(aiService.classifyIntent).toHaveBeenCalled();
      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('buy groceries tomorrow', []);
      expect(taskService.createTask).toHaveBeenCalled();
    });

    it('routes AI-classified query intent to search', async () => {
      vi.mocked(aiService.classifyIntent).mockResolvedValue({ intent: 'query', search: 'meeting', timeFilter: 'today' });
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([MOCK_TASK]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('how many meetings do I have today?'));

      expect(aiService.classifyIntent).toHaveBeenCalled();
      expect(taskService.getTasksForWhatsApp).toHaveBeenCalledWith('user-1', 'today', 'meeting');
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('matching "meeting"');
    });

    it('prefixes "remind me to" for remind command', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('remind call mom'));
      await flush();

      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith('remind me to call mom', []);
    });

    it('shows priority in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue({ ...PARSED, priority: 'high' });
      vi.mocked(taskService.createTask).mockResolvedValue({ ...MOCK_TASK, priority: 'high' });

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add urgent task'));
      await flush();

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('High');
    });

    it('shows category in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Personal');
    });

    it('shows due date in response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toMatch(/\d/); // has a date
    });

    it('shows reminder time when present', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTask).mockResolvedValue({
        ...MOCK_TASK,
        reminder_time: '2026-02-21T16:30:00.000Z',
      });

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('\u{1F514}');
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
      await flush();

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Similar task(s) found');
      expect(lastReply).toContain('Buy milk and eggs');
      expect(lastReply).toContain('75%');
      expect(lastReply).toContain('yes');
      expect(lastReply).toContain('no');
      // Task should NOT be created yet
      expect(taskService.createTask).not.toHaveBeenCalled();
    });

    it('creates task on "yes" confirmation', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Buy milk and eggs', similarity_score: 0.75 },
      ]);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();

      // First message triggers duplicate detection
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      // Second message confirms
      await handleMessage(sock, mockMsg('yes'));

      expect(taskService.createTaskFromParsed).toHaveBeenCalledWith('user-1', PARSED);
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Buy milk');
      expect(lastReply).toContain('added');
    });

    it('cancels task on "no" response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Buy milk and eggs', similarity_score: 0.75 },
      ]);

      const sock = mockSocket();

      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();
      await handleMessage(sock, mockMsg('no'));

      expect(taskService.createTaskFromParsed).not.toHaveBeenCalled();
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Cancelled');
    });

    it('accepts "y" as confirmation', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates).mockResolvedValue([
        { id: 'dup-1', title: 'Similar', similarity_score: 0.5 },
      ]);
      vi.mocked(taskService.createTaskFromParsed).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();
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
      await flush();
      await handleMessage(sock, mockMsg('n'));

      expect(taskService.createTaskFromParsed).not.toHaveBeenCalled();
    });

    it('clears pending and processes new command on non-yes/no response', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.findDuplicates)
        .mockResolvedValueOnce([{ id: 'dup-1', title: 'Similar', similarity_score: 0.5 }])
        .mockResolvedValue([]); // No duplicates for the new command
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();
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

  // ─── SUMMARY ───
  describe('summary command', () => {
    it('sends summary with stats, tasks, and reminders', async () => {
      vi.mocked(taskService.getTaskStats).mockResolvedValue({
        total: 5, pending: 3, in_progress: 1, completed: 1,
      });
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([MOCK_TASK]);
      vi.mocked(taskService.getUpcomingReminders).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('summary'));

      expect(taskService.getTaskStats).toHaveBeenCalledWith('user-1');
      expect(taskService.getTasksForWhatsApp).toHaveBeenCalledWith('user-1', 'today');
      expect(taskService.getUpcomingReminders).toHaveBeenCalledWith('user-1');

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Daily Summary');
      expect(reply).toContain('5 total');
      expect(reply).toContain('Buy milk');
    });

    it('shows no tasks message when none due today', async () => {
      vi.mocked(taskService.getTaskStats).mockResolvedValue({
        total: 0, pending: 0, in_progress: 0, completed: 0,
      });
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([]);
      vi.mocked(taskService.getUpcomingReminders).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('summary'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('None');
    });
  });

  // ─── VIDEOS ───
  describe('video link handling', () => {
    it('saves a YouTube link immediately and sends simple ack', async () => {
      const sock = mockSocket();
      await handleMessage(sock, mockMsg('https://www.youtube.com/watch?v=abc123'));

      expect(videoService.saveVideo).toHaveBeenCalledWith('user-1', 'https://www.youtube.com/watch?v=abc123', 'youtube');
      expect(videoService.enrichVideoTitle).toHaveBeenCalledWith('vid-1', 'https://www.youtube.com/watch?v=abc123', 'youtube');
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Added to');
      expect(reply).toContain('Videos');
    });

    it('saves an Instagram reel link', async () => {
      const sock = mockSocket();
      await handleMessage(sock, mockMsg('https://www.instagram.com/reel/ABC123/'));

      expect(videoService.saveVideo).toHaveBeenCalledWith('user-1', 'https://www.instagram.com/reel/ABC123/', 'instagram');
      expect(videoService.enrichVideoTitle).toHaveBeenCalled();
    });
  });

  describe('videos command', () => {
    it('lists saved videos', async () => {
      vi.mocked(videoService.getVideos).mockResolvedValue([
        { id: 'v1', title: '[YT] Cool Video', description: 'https://youtu.be/abc', status: 'pending', created_at: new Date().toISOString() },
      ]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('videos'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Saved Videos');
      expect(reply).toContain('Cool Video');
    });

    it('shows empty message when no videos', async () => {
      vi.mocked(videoService.getVideos).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('videos'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('No saved videos');
    });

    it('marks video as watched with "videos done 1"', async () => {
      vi.mocked(videoService.getVideos).mockResolvedValue([
        { id: 'v1', title: '[YT] Cool Video', description: 'url', status: 'pending', created_at: new Date().toISOString() },
      ]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('videos done 1'));

      expect(videoService.markVideoWatched).toHaveBeenCalledWith('v1');
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Watched');
      expect(reply).toContain('Cool Video');
    });

    it('shows error for invalid video number', async () => {
      vi.mocked(videoService.getVideos).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('videos done 5'));

      expect(videoService.markVideoWatched).not.toHaveBeenCalled();
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('not found');
    });
  });

  // ─── ERROR HANDLING ───
  describe('error handling', () => {
    it('sends error message on service failure', async () => {
      vi.mocked(taskService.getOrCreateUser).mockRejectedValue(new Error('DB error'));

      const sock = mockSocket();
      // Use a unique JID to avoid user cache hit from prior tests
      await handleMessage(sock, mockMsg('help', '9999999999@s.whatsapp.net'));

      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Something went wrong');
    });

    it('sends error message on AI failure', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockRejectedValue(new Error('AI down'));

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add buy milk'));
      await flush();

      // Background processing error sends failure message
      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Failed to add task');
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

  // ─── VOICE NOTES ───
  describe('voice note handling', () => {
    const PARSED = {
      title: 'Call the doctor',
      description: null,
      priority: 'medium' as const,
      category: 'Health',
      subcategory: null,
      due_date: null,
      reminder_time: '2026-02-22T15:00:00.000Z',
      is_recurring: false,
      recurrence_rule: null,
    };

    it('transcribes voice note and creates task', async () => {
      vi.mocked(transcribeVoiceMessage).mockResolvedValue('remind me to call the doctor Friday at 3pm');
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue(PARSED);
      vi.mocked(taskService.createTask).mockResolvedValue({
        ...MOCK_TASK,
        title: 'Call the doctor',
        categories: { name: 'Health' },
        reminder_time: '2026-02-22T15:00:00.000Z',
      });

      const sock = mockSocket();
      await handleMessage(sock, mockVoiceNote());
      await flush();

      // First reply = processing ack
      expect(sock.sendMessage.mock.calls[0][1].text).toContain('Processing voice note');
      // Transcription called
      expect(transcribeVoiceMessage).toHaveBeenCalled();
      // AI parsed the transcribed text
      expect(aiService.parseNaturalLanguage).toHaveBeenCalledWith(
        'remind me to call the doctor Friday at 3pm',
        []
      );
      // Task created
      expect(taskService.createTask).toHaveBeenCalled();
    });

    it('replies error when transcription returns null', async () => {
      vi.mocked(transcribeVoiceMessage).mockResolvedValue(null);

      const sock = mockSocket();
      await handleMessage(sock, mockVoiceNote());

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Could not transcribe');
    });

    it('replies error when transcription throws', async () => {
      vi.mocked(transcribeVoiceMessage).mockRejectedValue(new Error('API down'));

      const sock = mockSocket();
      await handleMessage(sock, mockVoiceNote());

      const lastReply = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1].text;
      expect(lastReply).toContain('Could not transcribe');
    });

    it('rejects voice notes when using Ollama', async () => {
      (env as any).AI_PROVIDER = 'ollama';

      const sock = mockSocket();
      await handleMessage(sock, mockVoiceNote());

      expect(transcribeVoiceMessage).not.toHaveBeenCalled();
      const reply = sock.sendMessage.mock.calls[0][1].text;
      expect(reply).toContain('Voice notes require OpenAI');
    });

    it('ignores non-ptt audio messages', async () => {
      const sock = mockSocket();
      // Audio with ptt=false (forwarded music file)
      const msg = mockVoiceNote('1234567890@s.whatsapp.net', false);
      await handleMessage(sock, msg);

      // No text and not a voice note → ignored
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ─── ACKNOWLEDGMENT ───
  describe('reminder acknowledgment', () => {
    it('acknowledges reminders after sync commands', async () => {
      vi.mocked(taskService.getTasksForWhatsApp).mockResolvedValue([]);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('list'));

      expect(taskService.acknowledgeReminders).toHaveBeenCalledWith('user-1');
    });

    it('does not acknowledge reminders for add (fire-and-forget)', async () => {
      vi.mocked(aiService.parseNaturalLanguage).mockResolvedValue({
        title: 'test', description: null, priority: 'medium' as const,
        category: null, subcategory: null, due_date: null,
        reminder_time: null, is_recurring: false, recurrence_rule: null,
      });
      vi.mocked(taskService.createTask).mockResolvedValue(MOCK_TASK);

      const sock = mockSocket();
      await handleMessage(sock, mockMsg('add test'));
      // add/remind returns early (before acknowledgeReminders)

      expect(taskService.acknowledgeReminders).not.toHaveBeenCalled();
    });
  });
});
