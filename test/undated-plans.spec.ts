// Undated plans: a plan still holding unscheduled work hatches its sidebar pill, so that an
// unplanned plan LOOKS unfinished and a fully-dated one looks clean. The rule is per-todo —
// open (unchecked), real (not a blank placeholder), and with no effective date — and dates are
// inherited, so a dated parent covers everything under it.
//
// These specs assert the .plan-undated CLASS, which is the contract; the stripes are
// decoration. The one exception is the last test, which checks the gradient actually survives
// on the active pill — that is a real CSS trap, not a cosmetic detail.

import { test, expect } from '@playwright/test';
import { layTree, node, plan, open } from './helpers.ts';

const WORK = 'p-work';
const HOME = 'p-home';
const PLANS = [plan(WORK, 'Work', 1), plan(HOME, 'Home', 2)];
const workPill = '.plan[data-id="p-work"]';
const homePill = '.plan[data-id="p-home"]';

// 2026-07-29
// The base case, both ways round in one page: Work holds an undated todo and hatches; Home's
// only todo carries a date and stays clean.
test('a plan with an undated todo hatches, a fully-dated one does not', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('a', null, 1, false, 'unscheduled thing', WORK),
      node('b', null, 2, false, 'scheduled thing', HOME, '2026-08-01'),
    ],
    PLANS,
  );
  await open(page, 1); // the page shows the active plan (Work) only

  await expect(page.locator(workPill)).toHaveClass(/plan-undated/);
  await expect(page.locator(homePill)).not.toHaveClass(/plan-undated/);
});

// 2026-07-29
// Dates are inherited, so a dated root covers its children: the child carries no date of its
// own but is not unscheduled, and the plan stays clean.
test('a child covered by a dated ancestor does not hatch its plan', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('p', null, 1, false, 'dated parent', HOME, '2026-08-01'),
      node('k', 'p', 1, false, 'undated child'),
      node('a', null, 1, false, 'keeps Work on the page', WORK, '2026-08-01'),
    ],
    PLANS,
  );
  await open(page, 1);

  await expect(page.locator(homePill)).not.toHaveClass(/plan-undated/);
});

// 2026-07-29
// Finished work needs no date. An undated todo that is checked off does not hatch its plan —
// only open work counts as unscheduled.
test('a checked undated todo does not hatch its plan', async ({ page, request }) => {
  await layTree(
    request,
    [
      node('a', null, 1, false, 'scheduled', WORK, '2026-08-01'),
      node('b', null, 1, true, 'done, never dated', HOME),
    ],
    PLANS,
  );
  await open(page, 1);

  await expect(page.locator(homePill)).not.toHaveClass(/plan-undated/);
});

// 2026-07-29
// The nag does not exempt the page you are on: the active plan carries both classes at once.
// (Work is first by order, so it is the plan the page lands on.)
test('the active plan keeps hatching while it has undated todos', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'unscheduled thing', WORK)], PLANS);
  await open(page, 1);

  await expect(page.locator(workPill)).toHaveClass(/plan-active/);
  await expect(page.locator(workPill)).toHaveClass(/plan-undated/);
});

// 2026-07-29
// The hatch clears live, on the keystroke — not on blur, not on reload. Dating the plan's last
// undated todo is what completes it, so that is the moment the pill goes clean.
test('dating the last undated todo clears the hatch as you type', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'buy milk', WORK)], PLANS);
  await open(page, 1);
  await expect(page.locator(workPill)).toHaveClass(/plan-undated/);

  const ta = page.locator('textarea[data-id="a"]');
  await ta.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' #2026-08-01');

  await expect(page.locator(workPill)).not.toHaveClass(/plan-undated/);
});

// 2026-07-29
// The stripes have to actually reach the ACTIVE pill. .plan-active sets its background with the
// shorthand, which resets background-image to none — so if the hatch rule were written or
// ordered differently, the plan you are looking at would silently stop nagging while still
// carrying the class every other test here asserts on.
test('the hatch survives on the active pill, not just the class', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'unscheduled thing', WORK)], PLANS);
  await open(page, 1);

  const backgroundImage = await page.locator(workPill).evaluate(
    (el) => getComputedStyle(el).backgroundImage,
  );
  expect(backgroundImage).toContain('gradient');
});
