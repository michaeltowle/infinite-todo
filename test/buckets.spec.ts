// Buckets: the drop-target/view pills in the #mono-sidebar's bucket-box. Each bucket is
// a lens onto one slice of the tree — click one and #todo-container shows only its todos;
// drop a todo on one and its subtree moves into that slice. The whole feature is the
// node's `hideUntil` field plus project()'s refusal to show a node outside the active
// bucket. The landing view is Unbucketed (the capture inbox).
//
// These specs drive the real drag-and-drop (locator.dragTo fires the native HTML5
// drag events in Chromium), and assert against the Durable Object rather than the
// page wherever the claim is about persistence.

import { test, expect, type Page } from '@playwright/test';
import { layTree, node, nodeById, open, readTree } from './helpers.ts';

// The dates the sidebar is showing, computed the same way the client does — local
// calendar days, not UTC. Kept here rather than imported so a bug in the client's own
// date maths cannot quietly agree with itself.
function localYMD(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const TOMORROW = () => localYMD(1);
const YESTERDAY = () => localYMD(-1);

// Drag a todo by its checkbox — the checkbox is the drag handle, deliberately, so the
// drag never competes with text selection inside the row's <input>.
async function dragToBucket(page: Page, todoID: string, bucketSelector: string) {
  await page
    .locator(`button[data-id="${todoID}"]`)
    .dragTo(page.locator(bucketSelector));
}

// The sidebar is a fixed ladder: Unbucketed at the top (the landing view), then Today
// and the next six days, then the two dateless buckets Big Ticket and Someday — ten in
// all, with the nearest dated ones labelled relatively. 2026-07-15
test('the bucket-box shows the full ladder of buckets', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);

  await expect(page.locator('.bucket')).toHaveCount(10);
  await expect(page.locator('.bucket').first()).toContainText('Unbucketed');
  await expect(page.locator('[data-key="today"]')).toContainText('Today');
  await expect(page.locator('[data-key="day-1"]')).toContainText('Tomorrow');
  await expect(page.locator('#bucket-big-ticket')).toContainText('Big Ticket');
  await expect(page.locator('.bucket').last()).toContainText('Someday');
  // Tomorrow's drop target hands out tomorrow's date.
  await expect(page.locator('[data-key="day-1"]')).toHaveAttribute('data-hide-until', TOMORROW());
  // Unbucketed's drop target is the empty string — a dropped todo gets a null hideUntil.
  await expect(page.locator('#bucket-unbucketed')).toHaveAttribute('data-hide-until', '');
});

// The page opens on the Unbucketed view — the capture inbox — with that bucket marked
// active. A todo assigned to another bucket does not show here. 2026-07-15
test('the page lands on the Unbucketed view', async ({ page, request }) => {
  await layTree(request, [
    node('inbox', null, 1, false, 'inbox item'),
    node('later', null, 2, false, 'later item', 'someday'),
  ]);
  await open(page, 1);

  await expect(page.locator('textarea[data-id="inbox"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="later"]')).toHaveCount(0);
  await expect(page.locator('#bucket-unbucketed')).toHaveClass(/bucket-active/);
});

// Clicking a bucket no longer empties it — it switches the active view. #todo-container
// then shows only that bucket's todos, and the clicked bucket is marked active. This is
// the fundamental change: a bucket is a lens you look through, not a pen you tip out.
// Nothing is rewritten by looking. 2026-07-15
test('clicking a bucket switches the view to show only its todos', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha', 'someday'),
    node('b', null, 2, false, 'beta', 'someday'),
    node('c', null, 3, false, 'gamma'),
  ]);
  await open(page, 1); // landing = Unbucketed: only the un-bucketed 'c' shows
  await expect(page.locator('textarea[data-id="c"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="a"]')).toHaveCount(0);

  await page.locator('#bucket-someday').click();

  await expect(page.locator('.todo-row')).toHaveCount(2);
  await expect(page.locator('textarea[data-id="a"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="b"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="c"]')).toHaveCount(0);
  await expect(page.locator('#bucket-someday')).toHaveClass(/bucket-active/);
  await expect(page.locator('#bucket-unbucketed')).not.toHaveClass(/bucket-active/);
  await expect.poll(async () => (await nodeById(request, 'a'))?.hideUntil).toBe('someday');
});

// Dropping a todo on a bucket takes it out of the current view and writes its hideUntil
// through to the Durable Object. Nothing is deleted — the node is still there, just in a
// different bucket. 2026-07-15 (was: drop on nth=0, which is now Unbucketed)
test('dropping a todo on a bucket moves it and persists hideUntil', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('b', null, 2, false, 'beta'),
  ]);
  await open(page, 2);

  await dragToBucket(page, 'a', '[data-key="day-1"]'); // Tomorrow

  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('textarea[data-id="b"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="a"]')).toHaveCount(0);

  await expect
    .poll(async () => (await nodeById(request, 'a'))?.hideUntil)
    .toBe(TOMORROW());
  // Still a node, still its text — bucketing is not deletion.
  expect((await nodeById(request, 'a'))?.keyboardText).toBe('alpha');
});

// The way back out of a dated (or dateless) bucket is to drop the todo on Unbucketed,
// which hands it a null hideUntil. Clicking used to do this; now clicking navigates, so
// Unbucketed being a real drop target is what makes a mis-drop a shrug. 2026-07-15
test('dropping a todo on Unbucketed tips it back out to a null hideUntil', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha', 'someday'),
    node('keep', null, 2, false, 'keep'),
  ]);
  await open(page, 1); // Unbucketed shows only 'keep'
  await page.locator('#bucket-someday').click();
  await expect(page.locator('textarea[data-id="a"]')).toBeVisible();

  await dragToBucket(page, 'a', '#bucket-unbucketed');

  await expect.poll(async () => (await nodeById(request, 'a'))?.hideUntil).toBeNull();
});

// A todo travels with its subtree: bucketing a parent takes its children off the
// board too, and none of them are individually rewritten. 2026-07-13
test('bucketing a parent takes its whole subtree off the board', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('parent', null, 1, false, 'parent'),
    node('kid', 'parent', 1, false, 'kid'),
    node('grandkid', 'kid', 1, false, 'grandkid'),
    node('other', null, 2, false, 'other'),
  ]);
  await open(page, 4);

  await dragToBucket(page, 'parent', '#bucket-someday');

  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('textarea[data-id="other"]')).toBeVisible();

  // Only the root carries a hideUntil. The children come off the board because their
  // root did, not because they were each bucketed.
  await expect.poll(async () => (await nodeById(request, 'parent'))?.hideUntil).toBe('someday');
  expect((await nodeById(request, 'kid'))?.hideUntil).toBeFalsy();
  expect((await nodeById(request, 'grandkid'))?.hideUntil).toBeFalsy();
});

// The count is what makes a bucket a plan rather than a hole: it says how much of a
// given day is already spoken for. Trees, not lines — a bucketed three-line tree is
// one thing to do, not three. 2026-07-13
test('a bucket counts the trees waiting in it, not their lines', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('parent', null, 1, false, 'parent'),
    node('kid', 'parent', 1, false, 'kid'),
    node('solo', null, 2, false, 'solo'),
    node('stays', null, 3, false, 'stays'),
  ]);
  await open(page, 4);

  await expect(page.locator('#bucket-someday .pill-text-secondary')).toHaveText('');

  await dragToBucket(page, 'parent', '#bucket-someday');
  await expect(page.locator('#bucket-someday .pill-text-secondary')).toHaveText('1');

  await dragToBucket(page, 'solo', '#bucket-someday');
  await expect(page.locator('#bucket-someday .pill-text-secondary')).toHaveText('2');
});

// A bucket is its own scratchpad: a todo typed while viewing a bucket belongs to that
// bucket, so it stays put instead of vanishing the moment it is created. Enter makes a
// second line in the same bucket. 2026-07-15
test('a todo created while viewing a bucket takes that bucket', async ({
  page,
  request,
}) => {
  await layTree(request, [node('anchor', null, 1, false, 'anchor')]);
  await open(page, 1);

  await page.locator('#bucket-big-ticket').click();
  // Empty Big Ticket seeds a blank line to type into — but a blank is not work, so it
  // must not show up in the bucket's count.
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('#bucket-big-ticket .pill-text-secondary')).toHaveText('');
  const input = page.locator('#todo-container textarea').first();
  await input.fill('a big one');
  await input.press('Enter'); // flushes the text edit + creates a sibling, both in Big Ticket

  await expect
    .poll(async () =>
      (await readTree(request)).find((n) => n.keyboardText === 'a big one')?.hideUntil,
    )
    .toBe('big-ticket');

  // It belongs to Big Ticket, not Unbucketed: the anchor is still the only thing there.
  await page.locator('#bucket-unbucketed').click();
  await expect(page.locator('#todo-container')).not.toContainText('a big one');
  await expect(page.locator('textarea[data-id="anchor"]')).toBeVisible();
});

// Big Ticket is a normal bucket for now — dropping a todo on it moves the tree there and
// bumps its count, exactly like Someday. Its distinct pill display (top nodes, days-to-
// due, percent-complete) comes later, once todos can carry due dates. 2026-07-15
test('dropping a todo on Big Ticket moves it there', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('b', null, 2, false, 'beta'),
  ]);
  await open(page, 2);

  await dragToBucket(page, 'a', '#bucket-big-ticket');

  await expect(page.locator('textarea[data-id="a"]')).toHaveCount(0);
  await expect.poll(async () => (await nodeById(request, 'a'))?.hideUntil).toBe('big-ticket');
  await expect(page.locator('#bucket-big-ticket .pill-text-secondary')).toHaveText('1');
});

// A todo bucketed for a day the calendar has reached is not lost: it surfaces in the
// Today view (due-today plus anything overdue), while a todo still in the future waits
// in its own day bucket and shows in neither Today nor Unbucketed. 2026-07-15
test('a todo whose day has arrived shows up in Today', async ({ page, request }) => {
  await layTree(request, [
    node('past', null, 1, false, 'due yesterday', YESTERDAY()),
    node('future', null, 2, false, 'due tomorrow', TOMORROW()),
  ]);
  // Landing view is Unbucketed; both todos are dated, so it is empty and seeds a blank.
  await open(page, 1);
  await expect(page.locator('textarea[data-id="past"]')).toHaveCount(0);

  await page.locator('[data-key="today"]').click();

  await expect(page.locator('textarea[data-id="past"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="future"]')).toHaveCount(0);
});

// Moving the last visible tree out of the active view empties it, and an empty view is a
// dead end — every keystroke handler is delegated off an textarea[data-id], so with no row
// there is nothing to type into. seedActiveIfEmpty() has to cover being emptied by a
// bucket drop, not just by a checkbox. 2026-07-13
test('bucketing the last visible tree seeds a blank line', async ({ page, request }) => {
  await layTree(request, [node('only', null, 1, false, 'the only todo')]);
  await open(page, 1);

  await dragToBucket(page, 'only', '#bucket-someday');

  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('#todo-container textarea')).toHaveValue('');
  // And the blank line is real — it reached the store, so a reload does not lose it.
  await expect
    .poll(async () => (await readTree(request)).filter((n) => !n.hideUntil).length)
    .toBe(1);
});
