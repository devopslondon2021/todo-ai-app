import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTaskList, formatHelp, formatCategoryTree } from '../utils/formatter.js';

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
    expect(result).toContain('Buy groceries');
    expect(result).toContain('plain English');
  });

  it('includes filter examples', () => {
    const result = formatHelp();
    expect(result).toContain('list today');
    expect(result).toContain('list work');
    expect(result).toContain('list completed');
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
