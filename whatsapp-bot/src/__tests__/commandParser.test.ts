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

    it('falls through to natural for invalid number', () => {
      expect(parseCommand('done abc')).toEqual({ type: 'natural', text: 'done abc' });
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
      expect(parseCommand('delete xyz')).toEqual({ type: 'natural', text: 'delete xyz' });
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

  // ─── NATURAL LANGUAGE (fallback) ───
  describe('natural language fallback', () => {
    it('treats plain sentences as natural', () => {
      expect(parseCommand('buy groceries tomorrow at 5pm')).toEqual({
        type: 'natural',
        text: 'buy groceries tomorrow at 5pm',
      });
    });

    it('treats unknown commands as natural', () => {
      expect(parseCommand('update task 1')).toEqual({
        type: 'natural',
        text: 'update task 1',
      });
    });

    it('treats empty-ish add as natural (just "add")', () => {
      // "add" without content — startsWith("add ") won't match
      expect(parseCommand('add')).toEqual({
        type: 'natural',
        text: 'add',
      });
    });

    it('preserves full input text', () => {
      const input = 'Submit the quarterly report to finance team by next Friday - high priority';
      expect(parseCommand(input)).toEqual({ type: 'natural', text: input });
    });
  });

  // ─── EDGE CASES ───
  describe('edge cases', () => {
    it('handles "done" without a number as natural', () => {
      expect(parseCommand('done')).toEqual({ type: 'natural', text: 'done' });
    });

    it('handles "delete" without a number as natural', () => {
      expect(parseCommand('delete')).toEqual({ type: 'natural', text: 'delete' });
    });

    it('handles "remind " with trailing space as natural', () => {
      // "remind " after trim() becomes "remind" which doesn't start with "remind "
      const result = parseCommand('remind ');
      expect(result).toEqual({ type: 'natural', text: 'remind' });
    });

    it('does NOT match "added something" as add', () => {
      expect(parseCommand('added something')).toEqual({ type: 'natural', text: 'added something' });
    });

    it('does NOT match "listing" as list', () => {
      expect(parseCommand('listing')).toEqual({ type: 'natural', text: 'listing' });
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
