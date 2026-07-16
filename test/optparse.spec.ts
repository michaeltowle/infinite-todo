// optparse: the low-friction '#'-tag parser that turns a todo's raw keyboardText into
// derived key-value data (getKey). Today the one recognised key is time-est — '#' + a
// number (whole or decimal) + 'hr'|'min' with nothing between the parts — and its only
// visible manifestation is the bucket pill's secondary line. That line shows the bucket's
// cumulative time-est alone as "h:mm" when any todo carries time; with no time it falls back
// to the unchecked count as "Nx". These specs drive the real page and assert on that pill,
// so they exercise the parser end to end rather than poking at an internal function.
// keyboardText stays the source of truth; getKey is re-derived on every render.

import { test, expect } from '@playwright/test';
import { layTree, node, open } from './helpers.ts';

// The landing view is Unbucketed, so a todo laid with a null hideUntil shows on open and
// its bucket is the one whose secondary text we read.
const SECONDARY = '#bucket-unbucketed .pill-text-secondary';

// A single '#Nmin' tag is parsed to time-est minutes and, because the bucket now carries
// time, shown alone as "h:mm" — the count 'x' is suppressed. 30 minutes formats as 0:30
// (hours un-padded). 2026-07-16
test('a #30min tag surfaces on the bucket as 0:30', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'walk the dog #30min')]);
  await open(page, 1);

  await expect(page.locator(SECONDARY)).toHaveText('0:30');
});

// Hours parse as well: '#2hr' is 120 minutes, formatted 2:00. 2026-07-16
test('a #2hr tag surfaces as 2:00', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'deep work #2hr')]);
  await open(page, 1);

  await expect(page.locator(SECONDARY)).toHaveText('2:00');
});

// A decimal amount parses: '#2.5hr' is 150 minutes, formatted 2:30 — the case that motivated
// widening the number to allow a fraction. 2026-07-16
test('a #2.5hr tag surfaces as 2:30', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'depart Toledo #2.5hr')]);
  await open(page, 1);

  await expect(page.locator(SECONDARY)).toHaveText('2:30');
});

// Two time tags on one line sum into a single total — '#1hr #30min' reads as 90 minutes
// (1:30), which doubles as a natural way to write an hour and a half. 2026-07-16
test('two time tags on one line sum to a single total', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'plan the week #1hr #30min')]);
  await open(page, 1);

  await expect(page.locator(SECONDARY)).toHaveText('1:30');
});

// The total is cumulative across every todo in the bucket. 60 + 30 = 90 minutes across two
// trees, shown alone as 1:30 (the two-tree count is suppressed while time is present).
// 2026-07-16
test('cumulative time sums across the whole bucket', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'first task #1hr'),
    node('b', null, 2, false, 'second task #30min'),
  ]);
  await open(page, 2);

  await expect(page.locator(SECONDARY)).toHaveText('1:30');
});

// Only unchecked todos count toward the cumulative time: a checked child's time-est is
// excluded, so a tree whose parent is unchecked (#30min) but whose child is checked (#1hr)
// contributes 30, not 90 — shown alone as 0:30. 2026-07-16
test('a checked todo does not contribute its time-est', async ({ page, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent #30min'),
    node('c', 'p', 1, true, 'finished child #1hr'),
  ]);
  await open(page, 2);

  await expect(page.locator(SECONDARY)).toHaveText('0:30');
});

// A '#'-run that is not exactly integer+hr|min is not a time-est and adds no time: neither
// '#30minutes' (trailing letters) nor '#1 hr' (a space splits it) parses, so the bucket
// shows the bare count with no time in parentheses. 2026-07-16
test('malformed time tags are left unparsed', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'read #30minutes and #1 hr')]);
  await open(page, 1);

  await expect(page.locator(SECONDARY)).toHaveText('1x');
});

// Typing a time tag updates the bucket total live, without any structural change (no
// Enter, no toggle) — the proof that onInput refreshes the bucket-box. The line starts as
// the bare count '1x' (no time yet) and, once the tag lands, flips to the time-only '0:45'.
// 2026-07-16
test('typing a time tag updates the bucket total live', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'task')]);
  await open(page, 1);
  await expect(page.locator(SECONDARY)).toHaveText('1x');

  await page.locator('textarea[data-id="a"]').fill('task #45min');

  await expect(page.locator(SECONDARY)).toHaveText('0:45');
});
