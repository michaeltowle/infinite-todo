// Priority: the right-sidebar box of todos ranked by dragging them onto it, gathered across
// every plan (like Today). Dragging a ranked row within the box reorders it; dragging it back
// out (anywhere else on the page) clears its rank. A ranked todo checked off earlier TODAY
// stays visible, crossed out, through the rest of the day — same midnight-rollover rule as
// Today (see completedToday in plans.ts) — rather than leaving the box right away. These specs
// drive the real page and assert persistence against the Durable Object.

import { test, expect } from '@playwright/test';
import { layTree, node, plan, open, nodeById } from './helpers.ts';

// Epoch ms for a moment `daysAgo` days before now — mirrors today.spec.ts's helper, so a spec
// can pin a todo's completedAt to a previous local day.
function completedDaysAgo(daysAgo: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// An unranked scratchpad shows the box's empty state, no rows. 2026-07-22
test('the priority-box is empty when nothing is ranked', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'someday maybe', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(0);
  await expect(page.locator('#priority-box .priority-empty')).toBeVisible();
});

// Dragging a todo's checkbox onto the priority-box ranks it: a non-null priority is written
// through to the Durable Object and the row appears in the box. 2026-07-22
test('dragging a todo onto the priority-box ranks it', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'ship the demo', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(0);

  await page.locator('button[data-id="a"]').dragTo(page.locator('#priority-box'));

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(1);
  await expect(page.locator('#priority-box')).toContainText('ship the demo');
  await expect.poll(async () => (await nodeById(request, 'a'))?.priority).not.toBeNull();
});

// The box is cross-plan: two already-ranked todos in two different plans both show, in rank
// order, regardless of which plan-page is active. 2026-07-22
test('the priority-box gathers ranked todos across every plan', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('w', null, 1, false, 'work thing', 'p-work', null, 0, null, 1),
      node('h', null, 1, false, 'home thing', 'p-home', null, 0, null, 2),
    ],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1); // viewing Work only

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(2);
  const texts = await page.locator('#priority-box .priority-todo-text').allTextContents();
  expect(texts).toEqual(['work thing', 'home thing']);
});

// Dragging an already-ranked row to just above another one persists a new priority that puts
// it first — a live reorder, not just an add. 2026-07-22
test('dragging a ranked row above another reorders them', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('first', null, 1, false, 'first one', 'p-work', null, 0, null, 1),
      node('second', null, 2, false, 'second one', 'p-work', null, 0, null, 2),
    ],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await expect(page.locator('#priority-box .priority-todo-text')).toHaveText(['first one', 'second one']);

  await page
    .locator('#priority-box button[data-id="second"]')
    .dragTo(page.locator('.priority-todo[data-id="first"]'), { targetPosition: { x: 10, y: 2 } });

  await expect(page.locator('#priority-box .priority-todo-text')).toHaveText(['second one', 'first one']);
  await expect
    .poll(async () => {
      const first = await nodeById(request, 'first');
      const second = await nodeById(request, 'second');
      return (second?.priority ?? 0) < (first?.priority ?? 0);
    })
    .toBe(true);
});

// Dragging a ranked row OUT of the priority-box — dropped on the plan-page — clears its
// priority (persisted null) and it leaves the box. Symmetric with dragging it in. 2026-07-22
test('dragging a ranked row out of the priority-box unranks it', async ({ page, request }) => {
  await layTree(
    request,
    [node('a', null, 1, false, 'ship the demo', 'p-work', null, 0, null, 1)],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 1);

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(1);

  await page
    .locator('#priority-box button[data-id="a"]')
    .dragTo(page.locator('#todo-container'));

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(0);
  await expect.poll(async () => (await nodeById(request, 'a'))?.priority ?? null).toBeNull();
});

// A ranked todo checked off earlier TODAY stays in the box, crossed out; one checked off
// YESTERDAY has already rolled over and is left out — same rank, only completedAt's day
// differs. 2026-07-22
test('a ranked todo completed today stays, but one completed yesterday has rolled over', async ({
  page,
  request,
}) => {
  await layTree(
    request,
    [
      node('fresh', null, 1, true, 'finished today', 'p-work', null, 0, Date.now(), 1),
      node('stale', null, 2, true, 'finished yesterday', 'p-work', null, 0, completedDaysAgo(1), 2),
    ],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await expect(page.locator('#priority-box .priority-todo')).toHaveCount(1);
  await expect(page.locator('#priority-box')).toContainText('finished today');
  await expect(page.locator('#priority-box .priority-todo')).toHaveAttribute('data-checked', '1');
});
