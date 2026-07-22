// Plans: the named containers a todo lives in, and the editable page you look at it on. Each
// plan is a pill in the left plan-box; click one and the center plan-page shows only its
// todos with the plan's name as an editable <h1>; drag a todo's checkbox onto a pill to move
// it into that plan. A plan is archived — it leaves the box — once every one of its todos is
// checked. These specs drive the real page and assert against the Durable Object wherever the
// claim is about persistence.

import { test, expect, type Page } from '@playwright/test';
import { layTree, node, plan, open, nodeById, planById, readTree, readPlans, cursor } from './helpers.ts';

// Drag a todo by its checkbox (the drag handle) onto a plan pill.
async function dragToPlan(page: Page, todoID: string, planID: string) {
  await page
    .locator(`button[data-id="${todoID}"]`)
    .dragTo(page.locator(`.plan[data-id="${planID}"]`));
}

// Epoch ms for a local datetime `days` before now at the given wall-clock time — lets a spec pin
// a plan's createdAt relative to whatever moment the suite runs on, so the creation-stamp format
// (time today / "yesterday" / an older date) can be asserted deterministically.
function createdDaysAgo(days: number, hours: number, minutes: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The plan-box lists every un-archived plan with its name and its completed fraction "done/total"
// — checked todos over all real todos. With nothing checked, Work (2 todos) reads "0/2" and Home
// (1 todo) "0/1". createdAt is 0 here, so no creation stamp joins it. 2026-07-22
test('the plan-box lists the plans with their completed fraction', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('a1', null, 1, false, 'first', 'p-work'),
      node('a2', null, 2, false, 'second', 'p-work'),
      node('b1', null, 1, false, 'home thing', 'p-home'),
    ],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 2); // lands on Work (order 1): a1, a2

  await expect(page.locator('.plan')).toHaveCount(2);
  await expect(page.locator('.plan[data-id="p-work"] .pill-text-primary')).toHaveText('Work');
  await expect(page.locator('.plan[data-id="p-work"] .pill-text-secondary')).toHaveText('0/2');
  await expect(page.locator('.plan[data-id="p-home"] .pill-text-secondary')).toHaveText('0/1');
});

// The page lands on the first plan: its name fills the <h1>, its pill is marked active, and
// only its todos render. 2026-07-21
test('the page lands on the first plan, name in the h1', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'first', 'p-work'), node('a2', null, 2, false, 'second', 'p-work')],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await expect(page.locator('#plan-page h1')).toHaveText('Work');
  await expect(page.locator('.plan[data-id="p-work"]')).toHaveClass(/plan-active/);
  await expect(page.locator('textarea[data-id="a1"]')).toBeVisible();
});

// Clicking a plan switches the page: the h1, the active pill, and the visible todos all move
// to the clicked plan; the other plan's todos are gone. Nothing is rewritten by looking.
// 2026-07-21
test('clicking a plan switches the page to it', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'work thing', 'p-work'), node('b1', null, 1, false, 'home thing', 'p-home')],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1); // Work: a1

  await page.locator('.plan[data-id="p-home"]').click();

  await expect(page.locator('#plan-page h1')).toHaveText('Home');
  await expect(page.locator('textarea[data-id="b1"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="a1"]')).toHaveCount(0);
  await expect(page.locator('.plan[data-id="p-home"]')).toHaveClass(/plan-active/);
  await expect(page.locator('.plan[data-id="p-work"]')).not.toHaveClass(/plan-active/);
});

// Editing the <h1> renames the plan: the pill updates live and the new name is written through
// to the Durable Object. 2026-07-21
test('editing the h1 renames the plan and persists', async ({ page, request }) => {
  await layTree(request, [node('a1', null, 1, false, 'a task', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await page.locator('#plan-page h1').fill('Renamed Plan');

  await expect(page.locator('.plan[data-id="p-work"] .pill-text-primary')).toHaveText('Renamed Plan');
  await expect.poll(async () => (await planById(request, 'p-work'))?.name).toBe('Renamed Plan');
});

// "+ add plan" makes a new plan, switches the page to it (so it can be named and typed into
// straight away), and persists it. The new plan is empty, so its page seeds one blank row.
// 2026-07-21
test('the add-plan button creates a plan and switches to it', async ({ page, request }) => {
  await layTree(request, [node('a1', null, 1, false, 'a task', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  await page.locator('.add-plan').click();

  await expect(page.locator('.plan')).toHaveCount(2);
  await expect(page.locator('.plan.plan-active')).toHaveCount(1);
  await expect(page.locator('.plan.plan-active[data-id="p-work"]')).toHaveCount(0);
  // The new plan's page is a single blank row, not Work's task.
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('#todo-container textarea')).toHaveValue('');
  await expect.poll(async () => (await readPlans(request)).length).toBe(2);
});

// Dropping a todo on a plan pill moves it into that plan — its planID is written through — and
// it leaves the page you were on. A subtree travels with its root. 2026-07-21
test('dropping a todo on a plan moves it there', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'first', 'p-work'), node('a2', null, 2, false, 'second', 'p-work')],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 2);

  await dragToPlan(page, 'a1', 'p-home');

  await expect(page.locator('textarea[data-id="a1"]')).toHaveCount(0);
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('textarea[data-id="a2"]')).toBeVisible();
  await expect.poll(async () => (await nodeById(request, 'a1'))?.planID).toBe('p-home');
});

// A checked todo stays on the page, struck through, as long as the plan still has open work —
// it is not removed the way a completed tree used to vanish. 2026-07-21
test('a checked todo stays visible while the plan is unfinished', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'one', 'p-work'), node('a2', null, 2, false, 'two', 'p-work')],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await page.locator('button[data-id="a1"]').click();

  await expect(page.locator('textarea[data-id="a1"]')).toBeVisible();
  await expect(page.locator('.todo-row:has(textarea[data-id="a1"])')).toHaveAttribute('data-checked', '1');
  await expect(page.locator('.plan[data-id="p-work"]')).toHaveClass(/plan-active/);
  await expect(page.locator('.todo-row')).toHaveCount(2);
});

// Checking the last open todo completes the plan, which then dies: it is archived (written
// through), drops off the plan-box, and the page moves to another live plan. 2026-07-21
test('checking the last todo archives the plan and moves on', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'the only task', 'p-work'), node('b1', null, 1, false, 'home thing', 'p-home')],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1); // Work: a1

  await page.locator('button[data-id="a1"]').click();

  await expect(page.locator('.plan[data-id="p-work"]')).toHaveCount(0);
  await expect(page.locator('.plan[data-id="p-home"]')).toHaveClass(/plan-active/);
  await expect.poll(async () => (await planById(request, 'p-work'))?.archived).toBe(true);
});

// A todo created while viewing a plan belongs to that plan, so it stays put instead of
// vanishing the moment it is made. 2026-07-21
test('a todo created on a plan-page takes that plan', async ({ page, request }) => {
  await layTree(
    request,
    [node('anchor', null, 1, false, 'anchor', 'p-work')],
    [plan('p-work', 'Work', 1), plan('p-home', 'Home', 2)],
  );
  await open(page, 1);

  const anchor = page.locator('#todo-container textarea').first();
  await anchor.click();
  await anchor.press('End');
  await anchor.press('Enter');
  const second = page.locator('#todo-container textarea').nth(1);
  await second.fill('a new one');

  await expect
    .poll(async () => (await readTree(request)).find((n) => n.keyboardText === 'a new one')?.planID)
    .toBe('p-work');
});

// The one-time migration off the old bucket model: with nodes present but no plans, every
// ACTIVE tree is swept into a plan called "Mike Todo", while a fully-checked (retired) tree is
// left with a null planID so it stays out of sight. 2026-07-21
test('the boot migration sweeps active trees into "Mike Todo"', async ({ page, request }) => {
  await layTree(
    request,
    [node('act', null, 1, false, 'active todo'), node('done', null, 2, true, 'finished todo')],
    [], // legacy: nodes, no plans
  );
  await open(page, 1); // Mike Todo shows 'act'; 'done' is planID-null and hidden

  await expect(page.locator('#plan-page h1')).toHaveText('Mike Todo');
  await expect(page.locator('textarea[data-id="act"]')).toBeVisible();
  await expect(page.locator('textarea[data-id="done"]')).toHaveCount(0);
  await expect.poll(async () => (await nodeById(request, 'act'))?.planID).toBe('mike-todo');
  await expect.poll(async () => (await nodeById(request, 'done'))?.planID ?? null).toBeNull();
  await expect.poll(async () => (await planById(request, 'mike-todo'))?.name).toBe('Mike Todo');
});

// ─── Completed fraction ──────────────────────────────────────────────────────

// The fraction's numerator is the checked count: one of three todos done reads "1/3". A blank
// seed line is not a todo and is left out of both numerator and denominator. 2026-07-22
test('the pill fraction counts checked todos over total', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('a1', null, 1, true, 'done one', 'p-work'),
      node('a2', null, 2, false, 'todo two', 'p-work'),
      node('a3', null, 3, false, 'todo three', 'p-work'),
    ],
    [plan('p-work', 'Work', 1)], // createdAt 0 → fraction only, no creation stamp
  );
  await open(page, 3);

  await expect(page.locator('.plan[data-id="p-work"] .pill-text-secondary')).toHaveText('1/3');
});

// ─── Creation stamp (createdAt datetime) ─────────────────────────────────────

// A plan created earlier today shows just the local time ("8:05am"), joined to the fraction.
// 2026-07-22
test('a plan created today shows its creation time', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'first', 'p-work')],
    [plan('p-work', 'Work', 1, false, createdDaysAgo(0, 8, 5))],
  );
  await open(page, 1);

  await expect(page.locator('.plan[data-id="p-work"] .pill-text-secondary')).toHaveText('0/1 · 8:05am');
});

// A plan created yesterday shows the time tagged "yesterday" — calendar yesterday, not a rolling
// 24 hours. 2026-07-22
test('a plan created yesterday shows the time with "yesterday"', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'first', 'p-work')],
    [plan('p-work', 'Work', 1, false, createdDaysAgo(1, 21, 35))],
  );
  await open(page, 1);

  await expect(page.locator('.plan[data-id="p-work"] .pill-text-secondary')).toHaveText(
    '0/1 · 9:35pm yesterday',
  );
});

// A plan created more than a day ago shows its calendar date in "Jul 3" style, no time. 2026-07-22
test('an older plan shows its creation date', async ({ page, request }) => {
  const createdAt = createdDaysAgo(5, 10, 0);
  const d = new Date(createdAt);
  const expected = `0/1 · ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
  await layTree(
    request,
    [node('a1', null, 1, false, 'first', 'p-work')],
    [plan('p-work', 'Work', 1, false, createdAt)],
  );
  await open(page, 1);

  await expect(page.locator('.plan[data-id="p-work"] .pill-text-secondary')).toHaveText(expected);
});

// ─── Enter in the plan title ─────────────────────────────────────────────────

// Enter in the plan-title <h1> commits the name and drops the caret into the plan's first todo —
// the Notion flow of naming a plan then typing into it — rather than dropping a newline into the
// heading. Focus lands on the first row's textarea at column 0. 2026-07-22
test('Enter in the plan title moves focus to the first todo', async ({ page, request }) => {
  await layTree(
    request,
    [node('a1', null, 1, false, 'first todo', 'p-work'), node('a2', null, 2, false, 'second', 'p-work')],
    [plan('p-work', 'Work', 1)],
  );
  await open(page, 2);

  await page.locator('#plan-page h1').click(); // put focus (and a caret) in the title
  await page.keyboard.press('Enter');

  expect(await cursor(page)).toMatchObject({ tag: 'TEXTAREA', id: 'a1', start: 0 });
});
