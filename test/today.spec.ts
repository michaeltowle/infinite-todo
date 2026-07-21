// Today: the read-only right-panel box that gathers, across every plan, each unchecked todo
// whose date is today — its own date, or one inherited from an ancestor. You look at what is
// due here; you plan only on a plan-page, so the box carries no inputs. A todo's date comes
// from an optparse '#'-tag in its text (see optparse.spec.ts) and the tag is stripped from
// what shows. These specs drive the real page.

import { test, expect } from '@playwright/test';
import { layTree, node, plan, open } from './helpers.ts';

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

// A checked todo, even if dated today, has nothing left to do, so it is left out of today.
// 2026-07-21
test('a checked todo dated today is left out of today', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, true, 'done #' + TODAY(), 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box .today-todo')).toHaveCount(0);
});

// The today-box is read-only — you plan only on a plan-page — so it carries no textareas and
// no checkboxes to interact with. 2026-07-21
test('the today-box is read-only', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'file taxes #' + TODAY(), 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#today-box textarea')).toHaveCount(0);
  await expect(page.locator('#today-box button')).toHaveCount(0);
});
