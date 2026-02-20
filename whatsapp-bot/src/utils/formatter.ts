interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  categories?: { name: string } | null;
}

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return '📋 No tasks found. Send a message to add one!';
  }

  const lines = tasks.map((t, i) => {
    const status = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
    const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    const cat = t.categories?.name ? ` [${t.categories.name}]` : '';
    const due = t.due_date ? ` 📅 ${formatDate(t.due_date)}` : '';

    return `${i + 1}. ${status} ${priority} *${t.title}*${cat}${due}`;
  });

  return `📋 *Your Tasks*\n\n${lines.join('\n')}\n\n_Reply "done [number]" to complete a task_`;
}

export function formatHelp(): string {
  return `🤖 *Todo AI Bot - Commands*

Just type naturally! Examples:
• _Buy groceries tomorrow at 5pm_
• _Remind me to call mom on Friday_
• _Submit report by end of day - high priority_

*Commands:*
• *add* [task] — Add a new task
• *list* — Show all pending tasks
• *list today* — Tasks due today
• *list work* — Tasks in work category
• *list completed* — Completed tasks
• *done* [number] — Mark task as complete
• *delete* [number] — Delete a task
• *categories* — View your categories
• *help* — Show this message

_Tip: You can also just describe what you need in plain English!_`;
}

/** Format categories as an indented tree */
export function formatCategoryTree(tree: CategoryNode[]): string {
  const lines: string[] = [];

  function walk(nodes: CategoryNode[], depth: number) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const bullet = depth === 0 ? '📁' : '└';
      lines.push(`${indent}${bullet} ${node.name}`);
      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(tree, 0);
  return `📂 *Your Categories*\n\n${lines.join('\n')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
