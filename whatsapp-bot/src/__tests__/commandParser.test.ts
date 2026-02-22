import { describe, it, expect } from 'vitest';
import { parseCommand } from '../handlers/commandParser.js';

describe('parseCommand', () => {
  // ─── HELP ───
  describe('help command', () => {
    it('parses "help"', () => {
      expect(parseCommand('help')).toEqual({ type: 'help' });
    });

    it('parses "/help"', () => {
      expect(parseCommand('/help')).toEqual({ type: 'help' });
    });

    it('parses "HELP" (case-insensitive)', () => {
      expect(parseCommand('HELP')).toEqual({ type: 'help' });
    });

    it('trims whitespace', () => {
      expect(parseCommand('  help  ')).toEqual({ type: 'help' });
    });
  });

  // ─── CATEGORIES ───
  describe('categories command', () => {
    it('parses "categories"', () => {
      expect(parseCommand('categories')).toEqual({ type: 'categories' });
    });

    it('parses "cats" shorthand', () => {
      expect(parseCommand('cats')).toEqual({ type: 'categories' });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('CATEGORIES')).toEqual({ type: 'categories' });
      expect(parseCommand('Cats')).toEqual({ type: 'categories' });
    });
  });

  // ─── ADD ───
  describe('add command', () => {
    it('parses "add buy milk"', () => {
      expect(parseCommand('add buy milk')).toEqual({ type: 'add', text: 'buy milk' });
    });

    it('preserves original case in text', () => {
      expect(parseCommand('Add Buy Milk Tomorrow')).toEqual({ type: 'add', text: 'Buy Milk Tomorrow' });
    });

    it('trims extra whitespace in text', () => {
      expect(parseCommand('add   buy milk  ')).toEqual({ type: 'add', text: 'buy milk' });
    });

    it('handles long task text', () => {
      const text = 'schedule meeting with team to discuss Q3 roadmap next Tuesday at 3pm';
      expect(parseCommand(`add ${text}`)).toEqual({ type: 'add', text });
    });
  });

  // ─── LIST ───
  describe('list command', () => {
    it('parses "list" with no filter', () => {
      expect(parseCommand('list')).toEqual({ type: 'list', filter: undefined });
    });

    it('parses "list today"', () => {
      expect(parseCommand('list today')).toEqual({ type: 'list', filter: 'today' });
    });

    it('parses "list completed"', () => {
      expect(parseCommand('list completed')).toEqual({ type: 'list', filter: 'completed' });
    });

    it('parses "list work"', () => {
      expect(parseCommand('list work')).toEqual({ type: 'list', filter: 'work' });
    });

    it('parses "list pending"', () => {
      expect(parseCommand('list pending')).toEqual({ type: 'list', filter: 'pending' });
    });

    it('is case-insensitive for keyword', () => {
      expect(parseCommand('LIST')).toEqual({ type: 'list', filter: undefined });
      expect(parseCommand('List Today')).toEqual({ type: 'list', filter: 'Today' });
    });
  });

  // ─── DONE ───
  describe('done command', () => {
    it('parses "done 1"', () => {
      expect(parseCommand('done 1')).toEqual({ type: 'done', taskNumber: 1 });
    });

    it('parses "done 15"', () => {
      expect(parseCommand('done 15')).toEqual({ type: 'done', taskNumber: 15 });
    });

    it('falls through to unknown for invalid number', () => {
      expect(parseCommand('done abc')).toEqual({ type: 'unknown', text: 'done abc' });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('Done 3')).toEqual({ type: 'done', taskNumber: 3 });
    });
  });

  // ─── DELETE / REMOVE ───
  describe('delete command', () => {
    it('parses "delete 1"', () => {
      expect(parseCommand('delete 1')).toEqual({ type: 'delete', taskNumber: 1 });
    });

    it('parses "remove 5"', () => {
      expect(parseCommand('remove 5')).toEqual({ type: 'delete', taskNumber: 5 });
    });

    it('falls through for invalid number', () => {
      expect(parseCommand('delete xyz')).toEqual({ type: 'unknown', text: 'delete xyz' });
    });
  });

  // ─── REMIND ───
  describe('remind command', () => {
    it('parses "remind call mom"', () => {
      expect(parseCommand('remind call mom')).toEqual({ type: 'remind', text: 'call mom' });
    });

    it('parses "reminder submit report by friday"', () => {
      expect(parseCommand('reminder submit report by friday')).toEqual({
        type: 'remind',
        text: 'submit report by friday',
      });
    });

    it('preserves case in text', () => {
      expect(parseCommand('Remind Call Doctor at 3PM')).toEqual({
        type: 'remind',
        text: 'Call Doctor at 3PM',
      });
    });
  });

  // ─── SUMMARY ───
  describe('summary command', () => {
    it('parses "summary"', () => {
      expect(parseCommand('summary')).toEqual({ type: 'summary' });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('SUMMARY')).toEqual({ type: 'summary' });
      expect(parseCommand('Summary')).toEqual({ type: 'summary' });
    });
  });

  // ─── NATURAL LANGUAGE ADD ───
  describe('natural language add variants', () => {
    it('parses "add a task buy groceries"', () => {
      expect(parseCommand('add a task buy groceries')).toEqual({ type: 'add', text: 'buy groceries' });
    });

    it('parses "add task buy groceries"', () => {
      expect(parseCommand('add task buy groceries')).toEqual({ type: 'add', text: 'buy groceries' });
    });

    it('preserves case in task text', () => {
      expect(parseCommand('Add A Task Buy Groceries')).toEqual({ type: 'add', text: 'Buy Groceries' });
    });
  });

  // ─── NATURAL LANGUAGE REMINDER ───
  describe('natural language reminder variants', () => {
    it('parses "add a reminder call doctor"', () => {
      expect(parseCommand('add a reminder call doctor')).toEqual({ type: 'remind', text: 'call doctor' });
    });

    it('parses "add reminder call doctor"', () => {
      expect(parseCommand('add reminder call doctor')).toEqual({ type: 'remind', text: 'call doctor' });
    });

    it('parses "set reminder call doctor"', () => {
      expect(parseCommand('set reminder call doctor')).toEqual({ type: 'remind', text: 'call doctor' });
    });

    it('parses "set a reminder call doctor"', () => {
      expect(parseCommand('set a reminder call doctor')).toEqual({ type: 'remind', text: 'call doctor' });
    });

    it('preserves case in reminder text', () => {
      expect(parseCommand('Set A Reminder Call Doctor at 3PM')).toEqual({ type: 'remind', text: 'Call Doctor at 3PM' });
    });
  });

  // ─── NATURAL LANGUAGE LIST ───
  describe('natural language list variants', () => {
    it('parses "show my tasks"', () => {
      expect(parseCommand('show my tasks')).toEqual({ type: 'list', filter: undefined });
    });

    it('parses "show tasks"', () => {
      expect(parseCommand('show tasks')).toEqual({ type: 'list', filter: undefined });
    });

    it('parses "get my tasks"', () => {
      expect(parseCommand('get my tasks')).toEqual({ type: 'list', filter: undefined });
    });

    it('parses "my tasks"', () => {
      expect(parseCommand('my tasks')).toEqual({ type: 'list', filter: undefined });
    });

    it('parses "show today\'s tasks"', () => {
      expect(parseCommand("show today's tasks")).toEqual({ type: 'list', filter: 'today' });
    });

    it('parses "show my today\'s tasks"', () => {
      expect(parseCommand("show my today's tasks")).toEqual({ type: 'list', filter: 'today' });
    });

    it('normalizes "list today\'s tasks" filter to "today"', () => {
      expect(parseCommand("list today's tasks")).toEqual({ type: 'list', filter: 'today' });
    });

    it('normalizes "list todays tasks" filter to "today"', () => {
      expect(parseCommand('list todays tasks')).toEqual({ type: 'list', filter: 'today' });
    });
  });

  // ─── UNKNOWN (fallback) ───
  describe('unknown command fallback', () => {
    it('treats plain sentences as unknown', () => {
      expect(parseCommand('buy groceries tomorrow at 5pm')).toEqual({
        type: 'unknown',
        text: 'buy groceries tomorrow at 5pm',
      });
    });

    it('treats unrecognized commands as unknown', () => {
      expect(parseCommand('update task 1')).toEqual({
        type: 'unknown',
        text: 'update task 1',
      });
    });

    it('treats empty-ish add as unknown (just "add")', () => {
      expect(parseCommand('add')).toEqual({
        type: 'unknown',
        text: 'add',
      });
    });

    it('treats random words as unknown (not task creation)', () => {
      expect(parseCommand('lost')).toEqual({ type: 'unknown', text: 'lost' });
      expect(parseCommand('hello')).toEqual({ type: 'unknown', text: 'hello' });
    });

    it('preserves full input text', () => {
      const input = 'Submit the quarterly report to finance team by next Friday - high priority';
      expect(parseCommand(input)).toEqual({ type: 'unknown', text: input });
    });
  });

  // ─── VIDEO LINK DETECTION ───
  describe('video link detection', () => {
    it('detects YouTube watch URL', () => {
      expect(parseCommand('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
        type: 'video_link',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        platform: 'youtube',
      });
    });

    it('detects youtu.be short URL', () => {
      expect(parseCommand('https://youtu.be/dQw4w9WgXcQ')).toEqual({
        type: 'video_link',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        platform: 'youtube',
      });
    });

    it('detects YouTube Shorts URL', () => {
      expect(parseCommand('https://youtube.com/shorts/abc123')).toEqual({
        type: 'video_link',
        url: 'https://youtube.com/shorts/abc123',
        platform: 'youtube',
      });
    });

    it('detects Instagram reel URL', () => {
      expect(parseCommand('https://www.instagram.com/reel/ABC123/')).toEqual({
        type: 'video_link',
        url: 'https://www.instagram.com/reel/ABC123/',
        platform: 'instagram',
      });
    });

    it('detects Instagram post URL', () => {
      expect(parseCommand('https://instagram.com/p/XYZ789/')).toEqual({
        type: 'video_link',
        url: 'https://instagram.com/p/XYZ789/',
        platform: 'instagram',
      });
    });

    it('extracts URL from surrounding text', () => {
      expect(parseCommand('Check this out https://youtu.be/abc123 so cool')).toEqual({
        type: 'video_link',
        url: 'https://youtu.be/abc123',
        platform: 'youtube',
      });
    });

    it('does not detect non-video URLs', () => {
      expect(parseCommand('https://www.google.com')).toEqual({
        type: 'unknown',
        text: 'https://www.google.com',
      });
    });
  });

  // ─── VIDEOS COMMAND ───
  describe('videos command', () => {
    it('parses "videos"', () => {
      expect(parseCommand('videos')).toEqual({ type: 'videos' });
    });

    it('parses "video"', () => {
      expect(parseCommand('video')).toEqual({ type: 'videos' });
    });

    it('parses "vids"', () => {
      expect(parseCommand('vids')).toEqual({ type: 'videos' });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('VIDEOS')).toEqual({ type: 'videos' });
      expect(parseCommand('Vids')).toEqual({ type: 'videos' });
    });

    it('parses "videos done 1"', () => {
      expect(parseCommand('videos done 1')).toEqual({
        type: 'videos',
        subcommand: 'done',
        taskNumber: 1,
      });
    });

    it('parses "video done 3"', () => {
      expect(parseCommand('video done 3')).toEqual({
        type: 'videos',
        subcommand: 'done',
        taskNumber: 3,
      });
    });

    it('parses "vids done 5"', () => {
      expect(parseCommand('vids done 5')).toEqual({
        type: 'videos',
        subcommand: 'done',
        taskNumber: 5,
      });
    });
  });

  // ─── EDGE CASES ───
  describe('edge cases', () => {
    it('handles "done" without a number as unknown', () => {
      expect(parseCommand('done')).toEqual({ type: 'unknown', text: 'done' });
    });

    it('handles "delete" without a number as unknown', () => {
      expect(parseCommand('delete')).toEqual({ type: 'unknown', text: 'delete' });
    });

    it('handles "remind " with trailing space as unknown', () => {
      const result = parseCommand('remind ');
      expect(result).toEqual({ type: 'unknown', text: 'remind' });
    });

    it('does NOT match "added something" as add', () => {
      expect(parseCommand('added something')).toEqual({ type: 'unknown', text: 'added something' });
    });

    it('does NOT match "listing" as list', () => {
      expect(parseCommand('listing')).toEqual({ type: 'unknown', text: 'listing' });
    });

    it('handles "done 0"', () => {
      expect(parseCommand('done 0')).toEqual({ type: 'done', taskNumber: 0 });
    });

    it('handles negative numbers in done', () => {
      // parseInt("-1") = -1 which is not NaN
      expect(parseCommand('done -1')).toEqual({ type: 'done', taskNumber: -1 });
    });
  });
});
