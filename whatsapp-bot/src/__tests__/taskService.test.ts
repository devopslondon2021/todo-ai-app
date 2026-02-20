import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase chainable mock ───
// Each test sets `resolveWith` before calling the service function.
// The proxy-based builder records calls and resolves the final awaited value.

let resolveWith: any = { data: null, error: null };
const recorded: { table: string; method: string; args: any[] }[] = [];

function makeBuilder(table: string): any {
  return new Proxy({} as any, {
    get(_, prop: string) {
      // Make the builder thenable so `await query` works
      if (prop === 'then') {
        return (resolve: any) => resolve(resolveWith);
      }
      if (prop === 'catch' || prop === 'finally') {
        return () => makeBuilder(table);
      }
      // Every method call records and returns the builder
      return (...args: any[]) => {
        recorded.push({ table, method: prop, args });
        if (prop === 'single') {
          return Promise.resolve(resolveWith);
        }
        return makeBuilder(table);
      };
    },
  });
}

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.fn((table: string) => makeBuilder(table));

vi.mock('../config/supabase.js', () => ({
  getSupabase: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

import {
  getOrCreateUser,
  createTaskFromParsed,
  getRecentTasks,
  getTasksForWhatsApp,
  markComplete,
  deleteTask,
  findDuplicates,
  getCategoryTree,
} from '../services/taskService.js';

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  resolveWith = { data: null, error: null };
  // Reset mockFrom to default implementation
  mockFrom.mockImplementation((table: string) => makeBuilder(table));
});

function findRecorded(method: string, table?: string) {
  return recorded.find((r) => r.method === method && (!table || r.table === table));
}

function findAllRecorded(method: string, table?: string) {
  return recorded.filter((r) => r.method === method && (!table || r.table === table));
}

// ─── getOrCreateUser ───
describe('getOrCreateUser', () => {
  it('returns existing user if found', async () => {
    const user = { id: 'user-1', whatsapp_jid: '123@s.whatsapp.net', name: '123' };
    resolveWith = { data: user, error: null };

    const result = await getOrCreateUser('123@s.whatsapp.net');
    expect(result).toEqual(user);
    expect(mockFrom).toHaveBeenCalledWith('users');
  });

  it('creates new user if not found', async () => {
    const newUser = { id: 'user-2', whatsapp_jid: '456@s.whatsapp.net', name: '456' };
    let singleCount = 0;

    // Flow: 1) JID lookup (null), 2) phone lookup (null), 3) unlinked user lookup (null), 4) insert .single() (newUser)
    function makeSelfBuilder(table: string): any {
      const handler: ProxyHandler<any> = {
        get(_, prop: string) {
          if (prop === 'then') return undefined;
          if (prop === 'catch' || prop === 'finally') return () => new Proxy({}, handler);
          return (...args: any[]) => {
            recorded.push({ table, method: prop, args });
            if (prop === 'single') {
              singleCount++;
              // First 3 singles: JID lookup, phone lookup, unlinked user lookup — all null
              if (singleCount <= 3) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              // 4th single: insert result
              return Promise.resolve({ data: newUser, error: null });
            }
            return new Proxy({}, handler);
          };
        },
      };
      return new Proxy({}, handler);
    }

    mockFrom.mockImplementation((table: string) => makeSelfBuilder(table));
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await getOrCreateUser('456@s.whatsapp.net');
    expect(result).toEqual(newUser);
    const insertCall = findRecorded('insert', 'users');
    expect(insertCall).toBeDefined();
    expect(insertCall!.args[0]).toEqual({
      whatsapp_jid: '456@s.whatsapp.net',
      phone_number: '456',
      name: '456',
    });
    expect(mockRpc).toHaveBeenCalledWith('seed_default_categories', { p_user_id: 'user-2' });
  });
});

// ─── createTaskFromParsed ───
describe('createTaskFromParsed', () => {
  const PARSED = {
    title: 'Buy groceries',
    description: 'Get milk and eggs',
    priority: 'medium' as const,
    category: 'Personal',
    subcategory: null,
    due_date: '2026-02-22T17:00:00.000Z',
    reminder_time: '2026-02-22T16:30:00.000Z',
    is_recurring: false,
    recurrence_rule: null,
  };

  it('inserts task with correct fields', async () => {
    let singleCount = 0;

    function makeSelfBuilder(table: string): any {
      const handler: ProxyHandler<any> = {
        get(_, prop: string) {
          if (prop === 'then') return undefined;
          if (prop === 'catch' || prop === 'finally') return () => new Proxy({}, handler);
          return (...args: any[]) => {
            recorded.push({ table, method: prop, args });
            if (prop === 'single') {
              singleCount++;
              if (singleCount === 1) return Promise.resolve({ data: { id: 'cat-1' }, error: null });
              if (singleCount === 2) return Promise.resolve({
                data: { id: 'task-1', title: 'Buy groceries', categories: { name: 'Personal' } },
                error: null,
              });
              return Promise.resolve({ data: null, error: null });
            }
            return new Proxy({}, handler);
          };
        },
      };
      return new Proxy({}, handler);
    }

    mockFrom.mockImplementation((table: string) => makeSelfBuilder(table));

    const result = await createTaskFromParsed('user-1', PARSED);
    expect(result.title).toBe('Buy groceries');
    expect(mockFrom).toHaveBeenCalledWith('tasks');
    expect(mockFrom).toHaveBeenCalledWith('reminders');
  });

  it('applies end-of-week default when no due_date', async () => {
    const noDue = { ...PARSED, due_date: null, reminder_time: null };
    let singleCount = 0;

    function makeSelfBuilder(table: string): any {
      const handler: ProxyHandler<any> = {
        get(_, prop: string) {
          if (prop === 'then') return undefined;
          if (prop === 'catch' || prop === 'finally') return () => new Proxy({}, handler);
          return (...args: any[]) => {
            recorded.push({ table, method: prop, args });
            if (prop === 'single') {
              singleCount++;
              if (singleCount === 1) return Promise.resolve({ data: { id: 'cat-1' }, error: null });
              return Promise.resolve({ data: { id: 'task-1', title: 'Buy groceries', categories: null }, error: null });
            }
            return new Proxy({}, handler);
          };
        },
      };
      return new Proxy({}, handler);
    }

    mockFrom.mockImplementation((table: string) => makeSelfBuilder(table));

    await createTaskFromParsed('user-1', noDue);
    const insertCall = findRecorded('insert', 'tasks');
    expect(insertCall).toBeDefined();
    expect(insertCall!.args[0].due_date).toBeTruthy();
    expect(insertCall!.args[0].due_date).toContain('T23:59:59');
  });
});

// ─── getRecentTasks ───
describe('getRecentTasks', () => {
  it('queries non-completed tasks limited to 20', async () => {
    const tasks = [{ id: 'task-1', title: 'Test' }];
    resolveWith = { data: tasks, error: null };

    const result = await getRecentTasks('user-1');
    expect(result).toEqual(tasks);
    expect(mockFrom).toHaveBeenCalledWith('tasks');
    expect(findRecorded('eq', 'tasks')?.args).toEqual(['user_id', 'user-1']);
    expect(findRecorded('neq', 'tasks')?.args).toEqual(['status', 'completed']);
    expect(findRecorded('order', 'tasks')?.args[0]).toBe('created_at');
    expect(findRecorded('limit', 'tasks')?.args[0]).toBe(20);
  });

  it('returns empty array when data is null', async () => {
    resolveWith = { data: null, error: null };
    const result = await getRecentTasks('user-1');
    expect(result).toEqual([]);
  });
});

// ─── getTasksForWhatsApp ───
describe('getTasksForWhatsApp', () => {
  it('filters by status for known statuses', async () => {
    resolveWith = { data: [], error: null };
    await getTasksForWhatsApp('user-1', 'completed');
    const eqCalls = findAllRecorded('eq', 'tasks');
    const statusCall = eqCalls.find((c) => c.args[0] === 'status');
    expect(statusCall?.args[1]).toBe('completed');
  });

  it('uses neq completed when no filter', async () => {
    resolveWith = { data: [], error: null };
    await getTasksForWhatsApp('user-1');
    expect(findRecorded('neq', 'tasks')?.args).toEqual(['status', 'completed']);
  });

  it('filters by today date range', async () => {
    resolveWith = { data: [], error: null };
    await getTasksForWhatsApp('user-1', 'today');
    expect(findRecorded('gte', 'tasks')).toBeDefined();
    expect(findRecorded('lte', 'tasks')).toBeDefined();
  });
});

// ─── markComplete ───
describe('markComplete', () => {
  it('updates task status to completed', async () => {
    resolveWith = { error: null };
    await markComplete('task-1');
    expect(mockFrom).toHaveBeenCalledWith('tasks');
    expect(findRecorded('update', 'tasks')?.args[0]).toEqual({ status: 'completed' });
    expect(findRecorded('eq', 'tasks')?.args).toEqual(['id', 'task-1']);
  });
});

// ─── deleteTask ───
describe('deleteTask', () => {
  it('deletes task by id', async () => {
    resolveWith = { error: null };
    await deleteTask('task-1');
    expect(mockFrom).toHaveBeenCalledWith('tasks');
    expect(findRecorded('delete', 'tasks')).toBeDefined();
    expect(findRecorded('eq', 'tasks')?.args).toEqual(['id', 'task-1']);
  });
});

// ─── findDuplicates ───
describe('findDuplicates', () => {
  it('calls find_similar_tasks RPC with correct params', async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: '1', title: 'Buy milk', similarity_score: 0.8 }],
      error: null,
    });

    const result = await findDuplicates('user-1', 'Buy milk');
    expect(mockRpc).toHaveBeenCalledWith('find_similar_tasks', {
      p_user_id: 'user-1',
      p_title: 'Buy milk',
      p_threshold: 0.3,
    });
    expect(result).toHaveLength(1);
    expect(result[0].similarity_score).toBe(0.8);
  });

  it('returns empty array on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'fail' } });
    const result = await findDuplicates('user-1', 'Buy milk');
    expect(result).toEqual([]);
  });
});

// ─── getCategoryTree ───
describe('getCategoryTree', () => {
  it('builds tree from flat categories', async () => {
    const flatCats = [
      { id: 'cat-1', name: 'Personal', parent_id: null, user_id: 'user-1' },
      { id: 'cat-2', name: 'Work', parent_id: null, user_id: 'user-1' },
      { id: 'cat-3', name: 'Health', parent_id: 'cat-1', user_id: 'user-1' },
    ];
    resolveWith = { data: flatCats, error: null };

    const tree = await getCategoryTree('user-1');
    expect(tree).toHaveLength(2);
    const personal = tree.find((c: any) => c.name === 'Personal');
    expect(personal).toBeDefined();
    expect(personal.children).toHaveLength(1);
    expect(personal.children[0].name).toBe('Health');
  });

  it('handles empty categories', async () => {
    resolveWith = { data: [], error: null };
    const tree = await getCategoryTree('user-1');
    expect(tree).toEqual([]);
  });
});
