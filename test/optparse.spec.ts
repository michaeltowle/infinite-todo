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
