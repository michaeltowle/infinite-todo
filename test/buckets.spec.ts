// Buckets: the drop-target days in the #mono-sidebar's bucket-box. A todo dropped on
// one leaves #todo-container until that morning, taking its subtree with it; clicking
// a bucket tips it back out. The whole feature is the node's `hideUntil` field plus
// walk()'s refusal to project a node the calendar has not reached.
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

// The sidebar offers tomorrow, the five days after it, and Someday — seven buckets,
// with the nearest one labelled relatively rather than by weekday name. 2026-07-13
test('the bucket-box shows six dated buckets plus Someday', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);

  await expect(page.locator('.bucket')).toHaveCount(7);
  await expect(page.locator('.bucket').first()).toContainText('Tomorrow');
  await expect(page.locator('#bucket-someday')).toContainText('Someday');
  // The nearest dated bucket is tomorrow's date, so a drop on it hides until tomorrow.
  await expect(page.locator('.bucket').first()).toHaveAttribute(
    'data-hide-until',
    TOMORROW(),
  );
});

// Dropping a todo on a bucket takes it off the board and writes its hideUntil through
// to the Durable Object. Nothing is deleted — the node is still there, just waiting.
// 2026-07-13
test('dropping a todo on a bucket hides it and persists hideUntil', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('b', null, 2, false, 'beta'),
  ]);
  await open(page, 2);

  await dragToBucket(page, 'a', '.bucket >> nth=0');

  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('input[data-id="b"]')).toBeVisible();
  await expect(page.locator('input[data-id="a"]')).toHaveCount(0);

  await expect
    .poll(async () => (await nodeById(request, 'a'))?.hideUntil)
    .toBe(TOMORROW());
  // Still a node, still its text — bucketing is not deletion.
  expect((await nodeById(request, 'a'))?.keyboardText).toBe('alpha');
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
  await expect(page.locator('input[data-id="other"]')).toBeVisible();

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

// The point of the whole feature: a todo bucketed for a day the calendar has since
// reached is back on the board, with nothing asked of the user. A hideUntil in the
// past is simply a hideUntil that has arrived. 2026-07-13
test('a todo whose day has arrived is back on the board', async ({ page, request }) => {
  await layTree(request, [
    node('past', null, 1, false, 'due yesterday', YESTERDAY()),
    node('future', null, 2, false, 'due tomorrow', TOMORROW()),
  ]);
  await open(page, 1);

  await expect(page.locator('input[data-id="past"]')).toBeVisible();
  await expect(page.locator('input[data-id="future"]')).toHaveCount(0);
});

// The way back out, and the reason a mis-drop is a shrug rather than a loss —
// especially onto Someday, which never arrives on its own. 2026-07-13
test('clicking a bucket tips its contents back onto the board', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha', 'someday'),
    node('b', null, 2, false, 'beta', 'someday'),
    node('c', null, 3, false, 'gamma'),
  ]);
  await open(page, 1);
  await expect(page.locator('#bucket-someday .pill-text-secondary')).toHaveText('2');

  await page.locator('#bucket-someday').click();

  await expect(page.locator('.todo-row')).toHaveCount(3);
  await expect(page.locator('#bucket-someday .pill-text-secondary')).toHaveText('');
  await expect.poll(async () => (await nodeById(request, 'a'))?.hideUntil).toBeNull();
  expect((await nodeById(request, 'b'))?.hideUntil).toBeNull();
});

// Bucketing the last visible tree empties the board, and an empty board is a dead end
// — every keystroke handler is delegated off an input[data-id], so with no row there
// is nothing to type into. seedIfEmpty() has to cover being emptied by a bucket, not
// just by a checkbox. 2026-07-13
test('bucketing the last visible tree seeds a blank line', async ({ page, request }) => {
  await layTree(request, [node('only', null, 1, false, 'the only todo')]);
  await open(page, 1);

  await dragToBucket(page, 'only', '#bucket-someday');

  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('#todo-container input')).toHaveValue('');
  // And the blank line is real — it reached the store, so a reload does not lose it.
  await expect
    .poll(async () => (await readTree(request)).filter((n) => !n.hideUntil).length)
    .toBe(1);
});
