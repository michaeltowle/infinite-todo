// Today: the read-only right-panel box that gathers, across every plan, each todo whose date is
// today — its own date, or one inherited from an ancestor — as long as it still has something
// to say: unchecked, or checked off earlier today and keeping its place (crossed out) through
// the rest of the day, rolling off at the next midnight. You look at what is due here; you plan
// only on a plan-page, so the box carries no free-text inputs. A todo's date comes from an
// optparse '#'-tag in its text (see optparse.spec.ts) and the tag is stripped from what shows.
// These specs drive the real page.

import { test, expect } from '@playwright/test';
import { layTree, node, plan, open, nodeById } from './helpers.ts';

// The dates the client is showing, computed the same way it does — local calendar days, not
// UTC — so a bug in the client's own date maths cannot quietly agree with itself.
function localYMD(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const TODAY = () => localYMD(0);
const TOMORROW = () => localYMD(1);

// Epoch ms for a moment `daysAgo` days before now — lets a spec pin a todo's completedAt to a
// previous local day, to exercise the midnight-rollover cutoff deterministically.
function completedDaysAgo(daysAgo: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// A todo dated today surfaces in the today-box, with its date tag stripped from the text.
// 2026-07-21
test('a todo dated today appears in the today-box, tag stripped', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'file taxes #' + TODAY(), 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box .today-todo')).toHaveText('file taxes');
});

// The box is cross-plan: a todo dated today in a plan you are NOT looking at still shows.
// 2026-07-21
test('the today-box gathers today across every plan', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('a', null, 1, false, 'file taxes #' + TODAY(), 'p-work'),
      node('b', null, 1, false, 'call plumber #' + TODAY(), 'p-home'),
    ],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1); // viewing Work (a) only

  await expect(page.locator('#today-box .today-todo')).toHaveCount(2);
  await expect(page.locator('#today-box')).toContainText('file taxes');
  await expect(page.locator('#today-box')).toContainText('call plumber');
});

// A child with no date of its own inherits its dated ancestor's date, so a child under a
// today-dated parent shows in the today-box too. 2026-07-21
test('a child inherits its ancestor date into today', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('p', null, 1, false, 'parent #' + TODAY(), 'p-work'),
      node('c', 'p', 1, false, 'child task'),
    ],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(2);
  await expect(page.locator('#today-box')).toContainText('child task');
});

// An undated todo is not due today: the box shows its empty state and no entries. 2026-07-21
test('an undated todo does not appear in today', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'someday maybe', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(0);
  await expect(page.locator('#today-box .today-empty')).toBeVisible();
});

// A future-dated todo waits: it is not in today until its day arrives. 2026-07-21
test('a future-dated todo does not appear in today', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'later #' + TOMORROW(), 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(0);
});

// A todo checked off on a PREVIOUS day, even if dated today, has already rolled over — no
// completedAt from today to keep it around — so it is left out of today. 2026-07-21
test('a todo checked on a previous day is left out of today', async ({ page, request }) => {
  await layTree(
    request,
    [node('a', null, 1, true, 'done #' + TODAY(), 'p-work', null, 0, completedDaysAgo(2))],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 1);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(0);
});

// The today-box text stays read-only — you plan only on a plan-page, so no textareas — but each
// row now carries a working checkbox. Clicking it checks the todo off (persisted to the DO,
// with a completedAt), and the row STAYS in the box, crossed out, rather than leaving right
// away — it rolls off only at the next midnight (see the rollover test below). Replaces the old
// "checking it drops it from today" test, which predated completedAt / the rollover rule.
// 2026-07-22
test('checking a today-box item checks the todo and keeps it crossed out', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'file taxes #' + TODAY(), 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box textarea')).toHaveCount(0); // still not editable
  await expect(page.locator('#today-box .today-todo')).toHaveCount(1);

  await page.locator('#today-box button[data-id="a"]').click();

  await expect.poll(async () => (await nodeById(request, 'a'))?.checked).toBe(true);
  await expect(page.locator('#today-box .today-todo')).toHaveCount(1); // stays, not gone
  await expect(page.locator('#today-box .today-todo')).toHaveAttribute('data-checked', '1');
});

// The rollover cutoff itself: a todo dated today but completed YESTERDAY does not show, while
// one completed earlier TODAY does — same due-date, only completedAt's day differs. 2026-07-22
test('a todo completed today stays, but one completed yesterday has rolled over', async ({
  page,
  request,
}) => {
  await layTree(
    request,
    [
      node('fresh', null, 1, true, 'finished today #' + TODAY(), 'p-work', null, 0, Date.now()),
      node('stale', null, 2, true, 'finished yesterday #' + TODAY(), 'p-work', null, 0, completedDaysAgo(1)),
    ],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(1);
  await expect(page.locator('#today-box')).toContainText('finished today');
});

// A today item can belong to a plan you are NOT looking at (today is cross-plan). Checking it off
// from the today-box must not yank you off your current plan-page — even when it was that other
// plan's last open todo and so completes and archives it. 2026-07-22
test('checking a today item from another plan does not switch the active page', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('w', null, 1, false, 'work thing', 'p-work'), // active plan, undated
      node('h', null, 1, false, 'home thing #' + TODAY(), 'p-home'), // other plan, due today
    ],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1); // lands on Work (order 1)
  await expect(page.locator('#plan-page h1')).toHaveText('Work');

  await page.locator('#today-box button[data-id="h"]').click();

  await expect.poll(async () => (await nodeById(request, 'h'))?.checked).toBe(true);
  await expect(page.locator('#plan-page h1')).toHaveText('Work'); // still on Work, not moved
});
