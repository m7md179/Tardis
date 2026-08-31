import { describe, it, expect } from 'bun:test';
import { scheduleKind, occursIn, nextRunAt, isValidSchedule } from './schedule.js';

/** A local wall-clock date, written the way a person would say it. */
const at = (iso: string) => new Date(iso);

describe('scheduleKind', () => {
  it('reads a cron expression as cron', () => {
    expect(scheduleKind('0 9 * * *')).toBe('cron');
    expect(scheduleKind('*/15 * * * *')).toBe('cron');
  });

  it('reads anything with FREQ= as an rrule', () => {
    // FREQ is required in every RRULE and cannot appear in cron, so this needs
    // no heuristics.
    expect(scheduleKind('FREQ=MONTHLY;BYDAY=-1FR')).toBe('rrule');
    expect(scheduleKind('RRULE:FREQ=DAILY;BYHOUR=9')).toBe('rrule');
    expect(scheduleKind('DTSTART:20260101T090000\nRRULE:FREQ=WEEKLY')).toBe('rrule');
  });
});

describe('isValidSchedule', () => {
  it('accepts both dialects', () => {
    expect(isValidSchedule('0 9 * * *')).toBe(true);
    expect(isValidSchedule('FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0')).toBe(true);
  });

  it('rejects nonsense in either', () => {
    expect(isValidSchedule('not a schedule')).toBe(false);
    expect(isValidSchedule('99 99 * * *')).toBe(false);
    expect(isValidSchedule('FREQ=NEVERLY')).toBe(false);
  });
});

// ─── The interval, which rrule must not disturb ──────────────────────────────

describe('occursIn: the double-fire guard', () => {
  it('fires an hourly cron exactly once across the boundary', () => {
    // The 2026 production bug: a ±60s window matched the same occurrence from
    // the tick before the hour and the tick after it, and every scheduled
    // message went out twice.
    const before = at('2026-08-27T13:59:00');
    const onTheHour = at('2026-08-27T14:00:00');
    const after = at('2026-08-27T14:01:00');

    expect(occursIn('0 * * * *', onTheHour, before)).toBe(true);
    expect(occursIn('0 * * * *', after, onTheHour)).toBe(false);
  });

  it('fires an rrule exactly once across the boundary too', () => {
    const before = at('2026-08-27T08:59:00');
    const onTheHour = at('2026-08-27T09:00:00');
    const after = at('2026-08-27T09:01:00');
    const daily = 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0';

    expect(occursIn(daily, onTheHour, before)).toBe(true);
    expect(occursIn(daily, after, onTheHour)).toBe(false);
  });

  it('catches an occurrence a drifting tick stepped over', () => {
    // setInterval drifts. A strict same-minute test would eventually skip an
    // occurrence entirely; the interval cannot.
    const since = at('2026-08-27T08:58:30');
    const now = at('2026-08-27T09:01:20');
    expect(occursIn('0 9 * * *', now, since)).toBe(true);
    expect(occursIn('FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', now, since)).toBe(true);
  });

  it('returns false for a zero-length or inverted window', () => {
    // What a restart produces: the baseline is taken as the service comes up,
    // so the first tick covers nothing and replays nothing.
    const t = at('2026-08-27T09:00:00');
    expect(occursIn('0 9 * * *', t, t)).toBe(false);
    expect(occursIn('0 9 * * *', t, at('2026-08-27T09:05:00'))).toBe(false);
  });

  it('returns false rather than throwing on an unparseable schedule', () => {
    expect(occursIn('nonsense', at('2026-08-27T09:00:00'))).toBe(false);
    expect(occursIn('FREQ=NEVERLY', at('2026-08-27T09:00:00'))).toBe(false);
  });
});

// ─── What rrule is actually for ──────────────────────────────────────────────

describe('occursIn: expressions cron cannot write', () => {
  it('fires on the last Friday of the month', () => {
    // 28 August 2026 is the last Friday of that month.
    const rule = 'FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0;BYSECOND=0';
    expect(occursIn(rule, at('2026-08-28T17:00:00'), at('2026-08-28T16:59:00'))).toBe(true);
  });

  it('does not fire on an earlier Friday of the same month', () => {
    // 21 August 2026 is a Friday, but not the last one. This is the case cron
    // gets wrong: `0 17 * * 5` fires on all of them.
    const rule = 'FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0;BYSECOND=0';
    expect(occursIn(rule, at('2026-08-21T17:00:00'), at('2026-08-21T16:59:00'))).toBe(false);
  });
});

// ─── Local time, matching cron ───────────────────────────────────────────────

describe('rrule times are local wall-clock, like cron', () => {
  it('reads BYHOUR as a local hour', () => {
    // rrule's own output is "floating": the UTC fields carry the rule's
    // wall-clock values. Left alone, `BYHOUR=9` would fire at 09:00 UTC — noon
    // in Amman — while `0 9 * * *` fired at 09:00 local. Two dialects on one
    // server disagreeing about what 9am means would be a nasty bug.
    const next = nextRunAt('FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', at('2026-08-27T00:00:00'));
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
  });

  it('agrees with the equivalent cron expression', () => {
    const from = at('2026-08-27T00:00:00');
    const viaCron = nextRunAt('0 9 * * *', from);
    const viaRrule = nextRunAt('FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', from);
    expect(viaRrule!.getTime()).toBe(viaCron!.getTime());
  });
});

// ─── next_run_at ─────────────────────────────────────────────────────────────

describe('nextRunAt', () => {
  it('answers for a cron schedule', () => {
    const next = nextRunAt('0 9 * * *', at('2026-08-27T10:00:00'));
    expect(next!.getDate()).toBe(28);
    expect(next!.getHours()).toBe(9);
  });

  it('answers for an rrule cron cannot express', () => {
    const next = nextRunAt(
      'FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0;BYSECOND=0',
      at('2026-08-01T00:00:00')
    );
    expect(next!.getFullYear()).toBe(2026);
    expect(next!.getMonth()).toBe(7); // August
    expect(next!.getDate()).toBe(28);
    expect(next!.getHours()).toBe(17);
  });

  it('anchors a bare rule to a fixed epoch, not to now', () => {
    // Without a DTSTART, rrule anchors to the moment it is parsed — so
    // `FREQ=MONTHLY;BYMONTHDAY=1` written on the 15th would first fire *next*
    // month. A rule must mean the same thing whenever it was written.
    const next = nextRunAt(
      'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=8;BYMINUTE=0;BYSECOND=0',
      at('2026-08-15T12:00:00')
    );
    expect(next!.getMonth()).toBe(8); // September
    expect(next!.getDate()).toBe(1);
  });

  it('skips an occurrence that lands inside quiet hours', () => {
    // The tick *skips* a quiet-hours run rather than deferring it, so reporting
    // 02:00 as the next run would be a lie.
    const next = nextRunAt('0 2 * * *', at('2026-08-27T00:00:00'), {
      start: '22:00',
      end: '08:00',
    });
    expect(next).toBeNull();
  });

  it('finds the first occurrence outside quiet hours', () => {
    const next = nextRunAt('0 * * * *', at('2026-08-27T23:10:00'), {
      start: '22:00',
      end: '08:00',
    });
    expect(next!.getHours()).toBe(8);
    expect(next!.getDate()).toBe(28);
  });

  it('returns null rather than hanging when quiet hours swallow everything', () => {
    // An unbounded walk here would hang the scheduler, not return a wrong
    // answer — much worse.
    const next = nextRunAt('0 2 * * *', at('2026-08-27T00:00:00'), {
      start: '00:00',
      end: '23:59',
    });
    expect(next).toBeNull();
  });

  it('returns null for a rule with no future occurrence', () => {
    expect(nextRunAt('FREQ=DAILY;COUNT=1;UNTIL=19700102T000000Z', at('2026-08-27T00:00:00'))).toBeNull();
  });

  it('returns null rather than throwing on nonsense', () => {
    expect(nextRunAt('not a schedule')).toBeNull();
  });
});
