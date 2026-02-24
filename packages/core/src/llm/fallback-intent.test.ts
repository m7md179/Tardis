import { describe, it, expect, beforeEach } from 'bun:test';
import {
  detectIntent,
  registerIntentPattern,
  unregisterIntentPatterns,
} from './fallback-intent.js';
import type { ToolDefinition } from '@tardis/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    actionType: 'direct',
  };
}

const TIMER_START = makeTool('time-tracker.start');
const TIMER_STOP = makeTool('time-tracker.stop');
const TIMER_PAUSE = makeTool('time-tracker.pause');
const TIMER_RESUME = makeTool('time-tracker.resume');
const TIMER_STATUS = makeTool('time-tracker.status');
const NOTES_SAVE = makeTool('notes.save');
const REMINDERS_SET = makeTool('reminders.set');
const TODOIST_ADD = makeTool('todoist.add-task');
const TODOIST_LIST = makeTool('todoist.list-tasks');

const ALL_TOOLS = [
  TIMER_START,
  TIMER_STOP,
  TIMER_PAUSE,
  TIMER_RESUME,
  TIMER_STATUS,
  NOTES_SAVE,
  REMINDERS_SET,
  TODOIST_ADD,
  TODOIST_LIST,
];

// ─── Returns null when nothing matches ────────────────────────────────────────

describe('detectIntent: no match', () => {
  it('returns null for casual conversation', () => {
    expect(detectIntent('Hello, how are you?', ALL_TOOLS)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectIntent('', ALL_TOOLS)).toBeNull();
  });

  it('returns null when available tools list is empty', () => {
    expect(detectIntent('start working on coding', [])).toBeNull();
  });

  it('returns null when matched tool is not in available tools', () => {
    // TIMER_START is not in the available tools
    expect(detectIntent('start working on coding', [NOTES_SAVE])).toBeNull();
  });
});

// ─── time-tracker.start ───────────────────────────────────────────────────────

describe('detectIntent: time-tracker.start', () => {
  it('matches "start working on X"', () => {
    const result = detectIntent('start working on the API refactor', [TIMER_START]);
    expect(result?.toolName).toBe('time-tracker.start');
    expect(result?.args['taskName']).toBe('the API refactor');
  });

  it('matches "start timer for X"', () => {
    const result = detectIntent('start timer for coding', [TIMER_START]);
    expect(result?.toolName).toBe('time-tracker.start');
    expect(result?.args['taskName']).toBe('coding');
  });

  it('matches "begin working on X"', () => {
    const result = detectIntent('begin working on the report', [TIMER_START]);
    expect(result?.toolName).toBe('time-tracker.start');
    expect(result?.args['taskName']).toBe('the report');
  });

  it('matches "track working on X"', () => {
    const result = detectIntent('track working on design', [TIMER_START]);
    expect(result?.toolName).toBe('time-tracker.start');
  });

  it('is case-insensitive', () => {
    const result = detectIntent('START WORKING ON design', [TIMER_START]);
    expect(result?.toolName).toBe('time-tracker.start');
  });

  it('includes matchedPattern label', () => {
    const result = detectIntent('start timer for work', [TIMER_START]);
    expect(result?.matchedPattern).toBe('start timer');
  });
});

// ─── time-tracker.stop ────────────────────────────────────────────────────────

describe('detectIntent: time-tracker.stop', () => {
  it('matches "stop the timer"', () => {
    expect(detectIntent('stop the timer', [TIMER_STOP])?.toolName).toBe('time-tracker.stop');
  });

  it('matches "end timer"', () => {
    expect(detectIntent('end timer', [TIMER_STOP])?.toolName).toBe('time-tracker.stop');
  });

  it('matches "finish timer"', () => {
    expect(detectIntent('finish timer', [TIMER_STOP])?.toolName).toBe('time-tracker.stop');
  });

  it('returns no taskName args', () => {
    const result = detectIntent('stop the timer', [TIMER_STOP]);
    expect(result?.args).toEqual({});
  });
});

// ─── time-tracker.pause / resume ──────────────────────────────────────────────

describe('detectIntent: pause/resume timer', () => {
  it('matches "pause timer"', () => {
    expect(detectIntent('pause timer', [TIMER_PAUSE])?.toolName).toBe('time-tracker.pause');
  });

  it('matches "hold the timer"', () => {
    expect(detectIntent('hold the timer', [TIMER_PAUSE])?.toolName).toBe('time-tracker.pause');
  });

  it('matches "resume timer"', () => {
    expect(detectIntent('resume timer', [TIMER_RESUME])?.toolName).toBe('time-tracker.resume');
  });

  it('matches "continue timer"', () => {
    expect(detectIntent('continue the timer', [TIMER_RESUME])?.toolName).toBe(
      'time-tracker.resume'
    );
  });
});

// ─── time-tracker.status ─────────────────────────────────────────────────────

describe('detectIntent: timer status', () => {
  it('matches "what\'s the timer"', () => {
    expect(detectIntent("what's the timer", [TIMER_STATUS])?.toolName).toBe('time-tracker.status');
  });

  it('matches "show timer status"', () => {
    expect(detectIntent('show timer status', [TIMER_STATUS])?.toolName).toBe('time-tracker.status');
  });

  it('matches "check timer"', () => {
    expect(detectIntent('check timer', [TIMER_STATUS])?.toolName).toBe('time-tracker.status');
  });
});

// ─── notes.save ──────────────────────────────────────────────────────────────

describe('detectIntent: notes.save', () => {
  it('matches "save note that X"', () => {
    const result = detectIntent('save note that the meeting is at 3pm', [NOTES_SAVE]);
    expect(result?.toolName).toBe('notes.save');
    expect(result?.args['content']).toContain('the meeting');
  });

  it('matches "remember this: X"', () => {
    const result = detectIntent('remember this: always use UTC timestamps', [NOTES_SAVE]);
    expect(result?.toolName).toBe('notes.save');
  });

  it('matches "note that X"', () => {
    const result = detectIntent('note that the API key expires on Friday', [NOTES_SAVE]);
    expect(result?.toolName).toBe('notes.save');
  });
});

// ─── reminders.set ───────────────────────────────────────────────────────────

describe('detectIntent: reminders.set', () => {
  it('matches "remind me to X"', () => {
    const result = detectIntent('remind me to call the doctor', [REMINDERS_SET]);
    expect(result?.toolName).toBe('reminders.set');
    expect(result?.args['message']).toContain('call the doctor');
  });

  it('matches "set a reminder for X"', () => {
    const result = detectIntent('set a reminder for the standup meeting', [REMINDERS_SET]);
    expect(result?.toolName).toBe('reminders.set');
  });
});

// ─── todoist ─────────────────────────────────────────────────────────────────

describe('detectIntent: todoist', () => {
  it('matches "add task: X"', () => {
    const result = detectIntent('add task: buy groceries', [TODOIST_ADD]);
    expect(result?.toolName).toBe('todoist.add-task');
    expect(result?.args['content']).toBe('buy groceries');
  });

  it('matches "add a task X"', () => {
    const result = detectIntent('add a task buy milk', [TODOIST_ADD]);
    expect(result?.toolName).toBe('todoist.add-task');
  });

  it('matches "list my tasks"', () => {
    expect(detectIntent('list my tasks', [TODOIST_LIST])?.toolName).toBe('todoist.list-tasks');
  });

  it('matches "show tasks"', () => {
    expect(detectIntent('show tasks', [TODOIST_LIST])?.toolName).toBe('todoist.list-tasks');
  });
});

// ─── Tool availability filter ─────────────────────────────────────────────────

describe('detectIntent: tool availability filter', () => {
  it('skips a pattern when the tool is not loaded', () => {
    // Message matches notes.save, but only timer tools are available
    const result = detectIntent('save note about the design', [TIMER_START, TIMER_STOP]);
    expect(result).toBeNull();
  });

  it('picks the first available matching tool', () => {
    // Both timer tools are available; start pattern matches first
    const result = detectIntent('start working on coding', [TIMER_START, TIMER_STOP]);
    expect(result?.toolName).toBe('time-tracker.start');
  });
});

// ─── Custom pattern registration ──────────────────────────────────────────────

describe('registerIntentPattern / unregisterIntentPatterns', () => {
  const CUSTOM_TOOL = 'my-plugin.do-thing';

  beforeEach(() => {
    // Clean up any custom patterns from previous tests
    unregisterIntentPatterns(CUSTOM_TOOL);
  });

  it('custom patterns are matched after registration', () => {
    registerIntentPattern({
      label: 'do the thing',
      pattern: /do the thing(?:\s+called\s+(.+))?/i,
      toolName: CUSTOM_TOOL,
      extractArgs: (match) => ({ name: (match[1] ?? 'default').trim() }),
    });

    const tool = makeTool(CUSTOM_TOOL);
    const result = detectIntent('do the thing called foobar', [tool]);
    expect(result?.toolName).toBe(CUSTOM_TOOL);
    expect(result?.args['name']).toBe('foobar');
  });

  it('unregistered patterns no longer match', () => {
    registerIntentPattern({
      label: 'temp pattern',
      pattern: /super unique phrase 12345/i,
      toolName: CUSTOM_TOOL,
      extractArgs: () => ({}),
    });

    const tool = makeTool(CUSTOM_TOOL);
    expect(detectIntent('super unique phrase 12345', [tool])).not.toBeNull();

    unregisterIntentPatterns(CUSTOM_TOOL);
    expect(detectIntent('super unique phrase 12345', [tool])).toBeNull();
  });
});
