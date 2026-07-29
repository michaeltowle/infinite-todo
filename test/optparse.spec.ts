// optparse: the low-friction '#'-tag parser that turns a todo's raw keyboardText into
// derived key-value data (getKey). The one recognised key now is `date` — a '#' followed by
// a date in one of a few shapes — and its value drives the read-only today-box (a todo whose
// date is today surfaces there). These specs exercise the parser directly rather than through
// a page: they assert both the derived date and that the tag is stripped from visibleDisplayText.
// keyboardText stays the source of truth; getKey is re-derived on every render.
//
// A fixed `now` pins the current year the yearless forms assume, so the assertions do not
// drift across calendar years.

import { test, expect } from '@playwright/test';
import { optparse } from '../src/client/optparse.ts';

const JAN_2026 = new Date(2026, 0, 15);

// A full ISO tag parses to itself and is stripped from the visible text. 2026-07-19
test('a #yyyy-mm-dd tag parses to that date and leaves the prose', () => {
  const { visibleDisplayText, getKey } = optparse('ship the thing #2026-08-01', JAN_2026);
  expect(getKey['date']).toBe('2026-08-01');
  expect(visibleDisplayText).toBe('ship the thing');
});

// A bare month/day assumes the current year (from `now`) and reads mm-dd. All the flexible
// spellings Mike asked for — '8-1', '8/1', zero-padded '08-01', and the month-name forms
// 'aug1' / 'aug-1' / 'august1' — land on the same 2026-08-01. 2026-07-19
test('the flexible mm-dd spellings all resolve to the same current-year date', () => {
  for (const tag of ['#8-1', '#8/1', '#08-01', '#aug1', '#aug-1', '#august1']) {
    expect(optparse('do it ' + tag, JAN_2026).getKey['date']).toBe('2026-08-01');
  }
});

// We never read dd-mm: '#13-1' cannot be month 13, so it is not silently re-read as day 13 /
// month 1 — it is not a real date, so it parses to nothing and is left in the visible text.
// 2026-07-19
test('a dd-mm-looking tag is rejected, not reinterpreted', () => {
  const { visibleDisplayText, getKey } = optparse('note #13-1 here', JAN_2026);
  expect(getKey['date']).toBeUndefined();
  expect(visibleDisplayText).toBe('note #13-1 here');
});

// A tag of the right shape but an impossible calendar day (Feb 30) parses to null and is left
// untouched, so a typo never vanishes silently. 2026-07-19
test('an impossible date is left in the text', () => {
  const { visibleDisplayText, getKey } = optparse('plan #2-30', JAN_2026);
  expect(getKey['date']).toBeUndefined();
  expect(visibleDisplayText).toBe('plan #2-30');
});

// The tag can sit anywhere on the line and is lifted cleanly out of the middle, leaving the
// words either side with a single space between them. 2026-07-21
test('a date tag mid-line is stripped without leaving a double space', () => {
  const { visibleDisplayText, getKey } = optparse('pay the #4-15 invoice', JAN_2026);
  expect(getKey['date']).toBe('2026-04-15');
  expect(visibleDisplayText).toBe('pay the invoice');
});

// A line with no '#' at all is returned verbatim (the common tag-less case). 2026-07-21
test('a tag-less line passes through unchanged', () => {
  const { visibleDisplayText, getKey } = optparse('just a plain todo', JAN_2026);
  expect(getKey['date']).toBeUndefined();
  expect(visibleDisplayText).toBe('just a plain todo');
});

// ─── Relative date tags ──────────────────────────────────────────────────────
// The bare-word shapes: '#today', '#tomorrow'/'#tom', and a weekday by name or three-letter
// abbreviation. Resolved against the injected `now`, so these read as calendar arithmetic
// rather than as whatever day the suite happens to run on. JAN_2026 is Thursday 15 Jan 2026.

// #today is now's own calendar day, and the tag comes out of the visible text like any
// other. 2026-07-29
test('#today resolves to the current day', () => {
  const { visibleDisplayText, getKey } = optparse('water plants #today', JAN_2026);
  expect(getKey['date']).toBe('2026-01-15');
  expect(visibleDisplayText).toBe('water plants');
});

// Tomorrow, spelled either way — '#tom' is the one Mike actually types. 2026-07-29
test('#tomorrow and #tom both resolve to the next day', () => {
  for (const tag of ['#tomorrow', '#tom']) {
    expect(optparse('bins out ' + tag, JAN_2026).getKey['date']).toBe('2026-01-16');
  }
});

// A weekday names the next one AHEAD: from Thursday the 15th, Monday is the 19th. Full name
// and abbreviation are the same tag, and case is irrelevant. 2026-07-29
test('a weekday tag resolves to the next occurrence, in any spelling', () => {
  for (const tag of ['#monday', '#mon', '#Monday', '#MON']) {
    expect(optparse('gym ' + tag, JAN_2026).getKey['date']).toBe('2026-01-19');
  }
});

// The rule is strictly-ahead, so the tag never means today: '#thu' typed ON a Thursday is
// next Thursday, a week out — '#today' is how you say today. 2026-07-29
test('a weekday tag typed on that weekday means next week', () => {
  expect(optparse('standup #thu', JAN_2026).getKey['date']).toBe('2026-01-22');
});

// The day arithmetic rolls over the end of a month (and so the year): from Sat 31 Jan 2026,
// tomorrow is 1 Feb, and the next Tuesday is 3 Feb. 2026-07-29
test('relative tags roll over the end of the month', () => {
  const JAN_31 = new Date(2026, 0, 31);
  expect(optparse('a #tom', JAN_31).getKey['date']).toBe('2026-02-01');
  expect(optparse('a #tue', JAN_31).getKey['date']).toBe('2026-02-03');
});

// The bare-word branch must not swallow ordinary hashtags. A word that names no day parses to
// nothing and stays in the visible text, exactly as an impossible numeric date does — this is
// what keeps '#groceries' a tag and not a silently-eaten date. 2026-07-29
test('a bare hashtag that is not a day is left in the text', () => {
  const { visibleDisplayText, getKey } = optparse('grab #groceries', JAN_2026);
  expect(getKey['date']).toBeUndefined();
  expect(visibleDisplayText).toBe('grab #groceries');
});

// A month name on its own is not a date — it has no day — so '#may' stays put rather than
// being read as a weekday-style relative tag. 2026-07-29
test('a bare month name is not a relative date', () => {
  const { visibleDisplayText, getKey } = optparse('plan #may', JAN_2026);
  expect(getKey['date']).toBeUndefined();
  expect(visibleDisplayText).toBe('plan #may');
});

// The new bare-word alternative sits last in the pattern, so the older month-name-plus-day
// shape still wins where both could apply. 2026-07-29
test('#aug1 still parses as a month and day, not a bare word', () => {
  expect(optparse('ship #aug1', JAN_2026).getKey['date']).toBe('2026-08-01');
});
