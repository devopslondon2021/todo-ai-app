import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTaskList, formatHelp, formatCategoryTree, formatSummary, formatQueryResult, formatVideoList } from '../utils/formatter.js';

describe('formatTaskList', () => {
  it('returns empty message when no tasks', () => {
    const result = formatTaskList([]);
    expect(result).toContain('No tasks found');
  });

  it('formats a single pending task', () => {
    const tasks = [
      { id: '1', title: 'Buy milk', priority: 'medium', status: 'pending', due_date: null },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('Your Tasks');
    expect(result).toContain('1.');
    expect(result).toContain('*Buy milk*');
    expect(result).toContain('done [number]');
  });

  it('shows correct status icons', () => {
    const tasks = [
      { id: '1', title: 'Pending', priority: 'low', status: 'pending', due_date: null },
      { id: '2', title: 'In progress', priority: 'medium', status: 'in_progress', due_date: null },
      { id: '3', title: 'Done', priority: 'high', status: 'completed', due_date: null },
    ];
    const result = formatTaskList(tasks);
    // pending = ⬜, in_progress = 🔄, completed = ✅
    const lines = result.split('\n');
    const line1 = lines.find(l => l.includes('Pending'))!;
    const line2 = lines.find(l => l.includes('In progress'))!;
    const line3 = lines.find(l => l.includes('Done'))!;
    expect(line1).toContain('⬜');
    expect(line2).toContain('🔄');
    expect(line3).toContain('✅');
  });

  it('shows correct priority icons', () => {
    const tasks = [
      { id: '1', title: 'Low', priority: 'low', status: 'pending', due_date: null },
      { id: '2', title: 'Med', priority: 'medium', status: 'pending', due_date: null },
      { id: '3', title: 'High', priority: 'high', status: 'pending', due_date: null },
    ];
    const result = formatTaskList(tasks);
    const lines = result.split('\n');
    expect(lines.find(l => l.includes('Low'))).toContain('🔵');
    expect(lines.find(l => l.includes('Med'))).toContain('🟡');
    expect(lines.find(l => l.includes('High'))).toContain('🔴');
  });

  it('shows category name in brackets', () => {
    const tasks = [
      { id: '1', title: 'Task', priority: 'medium', status: 'pending', due_date: null, categories: { name: 'Work' } },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('[Work]');
  });

  it('does not show category bracket when null', () => {
    const tasks = [
      { id: '1', title: 'Task', priority: 'medium', status: 'pending', due_date: null, categories: null },
    ];
    const result = formatTaskList(tasks);
    // The line for this task should not contain category brackets like [Work]
    const taskLine = result.split('\n').find(l => l.includes('*Task*'))!;
    expect(taskLine).not.toMatch(/\[.+\]/);
  });

  it('shows "Today" for today\'s due date', () => {
    const today = new Date().toISOString();
    const tasks = [
      { id: '1', title: 'Task', priority: 'medium', status: 'pending', due_date: today },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('Today');
  });

  it('shows "Tomorrow" for tomorrow\'s due date', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tasks = [
      { id: '1', title: 'Task', priority: 'medium', status: 'pending', due_date: tomorrow.toISOString() },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('Tomorrow');
  });

  it('numbers tasks sequentially', () => {
    const tasks = [
      { id: '1', title: 'First', priority: 'medium', status: 'pending', due_date: null },
      { id: '2', title: 'Second', priority: 'medium', status: 'pending', due_date: null },
      { id: '3', title: 'Third', priority: 'medium', status: 'pending', due_date: null },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
  });
});

describe('formatQueryResult', () => {
  it('formats tasks matching a search', () => {
    const tasks = [
      { id: '1', title: 'Team meeting', priority: 'high', status: 'pending', due_date: null },
      { id: '2', title: 'Client meeting', priority: 'medium', status: 'pending', due_date: null },
    ];
    const result = formatQueryResult(tasks, 'meeting');
    expect(result).toContain('Found 2 tasks matching "meeting"');
    expect(result).toContain('*Team meeting*');
    expect(result).toContain('*Client meeting*');
  });

  it('shows singular "task" for one result', () => {
    const tasks = [
      { id: '1', title: 'Team meeting', priority: 'high', status: 'pending', due_date: null },
    ];
    const result = formatQueryResult(tasks, 'meeting');
    expect(result).toContain('Found 1 task matching "meeting"');
  });

  it('shows time filter in header', () => {
    const tasks = [
      { id: '1', title: 'Team meeting', priority: 'high', status: 'pending', due_date: null },
    ];
    const result = formatQueryResult(tasks, 'meeting', 'today');
    expect(result).toContain('for today');
  });

  it('returns empty message when no results', () => {
    const result = formatQueryResult([], 'meeting');
    expect(result).toContain('No tasks matching "meeting"');
  });

  it('returns empty message with time filter', () => {
    const result = formatQueryResult([], 'meeting', 'today');
    expect(result).toContain('No tasks matching "meeting" for today');
  });

  it('shows time alongside date for tasks with a specific time', () => {
    // 3:00 PM UTC — the formatted time depends on locale but should contain a time portion
    const tasks = [
      { id: '1', title: 'Team meeting', priority: 'high', status: 'pending', due_date: '2026-02-21T15:00:00.000Z' },
    ];
    const result = formatQueryResult(tasks, 'meeting', 'today');
    // Should contain a time like "3:00 PM" or locale equivalent (with AM/PM)
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
  });

  it('does not show time when due_date is midnight (date-only task)', () => {
    const tasks = [
      { id: '1', title: 'All day task', priority: 'low', status: 'pending', due_date: '2026-03-15T00:00:00.000Z' },
    ];
    const result = formatQueryResult(tasks, 'task');
    // Should NOT contain a time portion — only the date
    const taskLine = result.split('\n').find(l => l.includes('*All day task*'))!;
    expect(taskLine).not.toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
  });
});

describe('formatHelp', () => {
  it('returns help text with commands', () => {
    const result = formatHelp();
    expect(result).toContain('Todo AI Bot');
    expect(result).toContain('add');
    expect(result).toContain('list');
    expect(result).toContain('done');
    expect(result).toContain('delete');
    expect(result).toContain('categories');
    expect(result).toContain('help');
  });

  it('includes natural language examples', () => {
    const result = formatHelp();
    expect(result).toContain('buy groceries');
    expect(result).toContain('call doctor');
  });

  it('includes summary command', () => {
    const result = formatHelp();
    expect(result).toContain('summary');
  });

  it('includes natural language section', () => {
    const result = formatHelp();
    expect(result).toContain('Natural Language');
    expect(result).toContain('meetings');
  });

  it('shows call escalation note when enabled', () => {
    const result = formatHelp(true);
    expect(result).toContain('phone call reminder');
  });

  it('hides call escalation note when disabled', () => {
    const result = formatHelp(false);
    expect(result).not.toContain('phone call');
  });

  it('includes filter examples', () => {
    const result = formatHelp();
    expect(result).toContain('list today');
    expect(result).toContain('list work');
    expect(result).toContain('list completed');
  });

  it('includes videos section', () => {
    const result = formatHelp();
    expect(result).toContain('Videos');
    expect(result).toContain('videos');
    expect(result).toContain('videos done');
  });
});

describe('formatCategoryTree', () => {
  it('formats root categories', () => {
    const tree = [
      { id: '1', name: 'Personal', children: [] },
      { id: '2', name: 'Work', children: [] },
    ];
    const result = formatCategoryTree(tree);
    expect(result).toContain('Your Categories');
    expect(result).toContain('Personal');
    expect(result).toContain('Work');
  });

  it('formats nested subcategories', () => {
    const tree = [
      {
        id: '1',
        name: 'Personal',
        children: [
          { id: '3', name: 'Health', children: [] },
          { id: '4', name: 'Shopping', children: [] },
        ],
      },
    ];
    const result = formatCategoryTree(tree);
    expect(result).toContain('Personal');
    expect(result).toContain('Health');
    expect(result).toContain('Shopping');
    // Subcategories should use '└' bullet
    expect(result).toContain('└');
  });

  it('uses folder icon for root categories', () => {
    const tree = [{ id: '1', name: 'Work', children: [] }];
    const result = formatCategoryTree(tree);
    expect(result).toContain('📁');
  });

  it('handles deeply nested categories', () => {
    const tree = [
      {
        id: '1',
        name: 'Work',
        children: [
          {
            id: '2',
            name: 'Projects',
            children: [
              { id: '3', name: 'Todo AI', children: [] },
            ],
          },
        ],
      },
    ];
    const result = formatCategoryTree(tree);
    expect(result).toContain('Work');
    expect(result).toContain('Projects');
    expect(result).toContain('Todo AI');
  });
});

describe('formatSummary', () => {
  const STATS = { total: 10, pending: 5, in_progress: 2, completed: 3 };

  it('shows stats', () => {
    const result = formatSummary(STATS, [], []);
    expect(result).toContain('Daily Summary');
    expect(result).toContain('10 total');
    expect(result).toContain('5 pending');
    expect(result).toContain('2 in progress');
    expect(result).toContain('3 completed');
  });

  it('shows "None" when no tasks due today', () => {
    const result = formatSummary(STATS, [], []);
    expect(result).toContain('Due Today:* None');
  });

  it('lists today tasks with priority icons', () => {
    const tasks = [
      { id: '1', title: 'High task', priority: 'high', status: 'pending', due_date: null },
      { id: '2', title: 'Low task', priority: 'low', status: 'pending', due_date: null },
    ];
    const result = formatSummary(STATS, tasks, []);
    expect(result).toContain('🔴');
    expect(result).toContain('*High task*');
    expect(result).toContain('🔵');
    expect(result).toContain('*Low task*');
  });

  it('shows upcoming reminders', () => {
    const reminders = [
      { id: 'r1', reminder_time: '2026-02-22T15:00:00.000Z', tasks: { title: 'Call doctor' } },
    ];
    const result = formatSummary(STATS, [], reminders);
    expect(result).toContain('Upcoming Reminders');
    expect(result).toContain('Call doctor');
  });

  it('handles reminders with tasks as array (Supabase join)', () => {
    const reminders = [
      { id: 'r1', reminder_time: '2026-02-22T15:00:00.000Z', tasks: [{ title: 'Array task' }] },
    ];
    const result = formatSummary(STATS, [], reminders);
    expect(result).toContain('Array task');
  });

  it('hides reminders section when empty', () => {
    const result = formatSummary(STATS, [], []);
    expect(result).not.toContain('Upcoming Reminders');
  });
});

describe('formatVideoList', () => {
  it('returns empty message when no videos', () => {
    const result = formatVideoList([]);
    expect(result).toContain('No saved videos');
  });

  it('formats a YouTube video', () => {
    const videos = [
      { id: '1', title: '[YT] Never Gonna Give You Up', description: 'https://youtu.be/abc', status: 'pending', created_at: new Date().toISOString() },
    ];
    const result = formatVideoList(videos);
    expect(result).toContain('Saved Videos');
    expect(result).toContain('1.');
    expect(result).toContain('*Never Gonna Give You Up*');
    expect(result).toContain('YouTube');
    expect(result).toContain('videos done [number]');
  });

  it('formats an Instagram video', () => {
    const videos = [
      { id: '1', title: '[IG] Instagram Reel', description: 'https://instagram.com/reel/abc', status: 'pending', created_at: new Date().toISOString() },
    ];
    const result = formatVideoList(videos);
    expect(result).toContain('*Instagram Reel*');
    expect(result).toContain('Instagram');
  });

  it('numbers videos sequentially', () => {
    const videos = [
      { id: '1', title: '[YT] Video One', description: 'url1', status: 'pending', created_at: new Date().toISOString() },
      { id: '2', title: '[IG] Video Two', description: 'url2', status: 'pending', created_at: new Date().toISOString() },
    ];
    const result = formatVideoList(videos);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
  });

  it('shows Today for videos saved today', () => {
    const videos = [
      { id: '1', title: '[YT] Fresh Video', description: 'url', status: 'pending', created_at: new Date().toISOString() },
    ];
    const result = formatVideoList(videos);
    expect(result).toContain('Today');
  });
});
