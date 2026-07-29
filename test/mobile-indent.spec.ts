// Mobile indent gesture: on a touch device (no Tab key), swiping a row rightward indents it
// under its previous sibling. The counterpart of the period-at-line-start outdent
// (mobile-dedent.spec.ts) — together they are Tab and Shift+Tab for a phone.
//
// Everything here turns on the same two facts the outdent gesture does: the pointer is coarse
// (isMobile in client-main), and the gesture is unambiguously horizontal. Persistence
// assertions read the Durable Object through the helpers.
//
// The swipe is dispatched as synthetic touch events (see swipe() in helpers) — that drives our
// handler exactly, but says nothing about the browser's own gesture arbitration, so the feel of
// the thing still wants a real device.

import { test, expect, devices } from '@playwright/test';
import { layTree, node, nodeById, open, swipe } from './helpers.ts';

// The iPhone 13 profile — Mike's one reference mobile screen (CLAUDE.md) — minus its
// defaultBrowserType, for the reason mobile-dedent.spec.ts gives: our config runs chromium
// only, and changing browser type inside a describe forces a new worker.
const { defaultBrowserType: _webkit, ...IPHONE_13 } = devices['iPhone 13'];

// Two roots in a row: 'b' has a previous sibling to indent under, which is the minimal shape.
const SIBLINGS = [
  node('a', null, 1, false, 'first'),
  node('b', null, 2, false, 'second'),
];

test.describe('on mobile (coarse pointer)', () => {
  test.use(IPHONE_13);

  // 2026-07-29
  // The gesture itself: swipe a root row to the right and it becomes a child of the row above
  // it (parentID 'a' in the DO), with its text untouched. The precondition assert pins the
  // emulation dependency, as the dedent spec does: if the coarse-pointer signal stops matching,
  // this fails loudly and on purpose.
  test('a rightward swipe indents the row under its previous sibling', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    await swipe(page, 'b', 90);

    await expect.poll(async () => (await nodeById(request, 'b'))?.parentID).toBe('a');
    expect(await page.locator('textarea[data-id="b"]').inputValue()).toBe('second');
  });

  // 2026-07-29
  // Scrolling must never indent. A vertical drag — even one that wanders sideways as a thumb
  // does — leaves the row where it is.
  test('a vertical swipe does not indent', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);

    await swipe(page, 'b', 30, 120);

    await page.waitForTimeout(200); // give a wrong indent time to reach the DO
    expect((await nodeById(request, 'b'))?.parentID).toBe(null);
  });

  // 2026-07-29
  // A short swipe is a smudged tap, not a gesture: under the threshold nothing happens.
  test('a swipe shorter than the threshold does not indent', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);

    await swipe(page, 'b', 20);

    await page.waitForTimeout(200);
    expect((await nodeById(request, 'b'))?.parentID).toBe(null);
  });

  // 2026-07-29
  // The first row has no previous sibling, so there is nothing to indent under — the swipe is a
  // no-op rather than an error, exactly as Tab is on the first line.
  test('swiping the first row is a no-op', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);

    await swipe(page, 'a', 90);

    await page.waitForTimeout(200);
    expect((await nodeById(request, 'a'))?.parentID).toBe(null);
  });

  // 2026-07-29
  // One swipe, one level. Dragging far past the threshold must not walk the row across the
  // page, any more than holding Tab down would — 'b' ends up under 'a' and no deeper.
  test('a long swipe indents exactly one level', async ({ page, request }) => {
    await layTree(request, [
      node('a', null, 1, false, 'first'),
      node('b', null, 2, false, 'second'),
      node('c', null, 3, false, 'third'),
    ]);
    await open(page, 3);

    await swipe(page, 'c', 250);

    await expect.poll(async () => (await nodeById(request, 'c'))?.parentID).toBe('b');
    expect((await nodeById(request, 'b'))?.parentID).toBe(null); // 'b' did not move with it
  });

  // 2026-07-29
  // The left edge of the screen belongs to the browser (iOS Safari's back-navigation swipe), so
  // a gesture starting inside that band is left alone rather than fought over.
  test('a swipe starting at the screen edge does not indent', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);

    await swipe(page, 'b', 90, 0, { x: 5, y: 200 });

    await page.waitForTimeout(200);
    expect((await nodeById(request, 'b'))?.parentID).toBe(null);
  });
});

test.describe('on desktop (fine pointer)', () => {
  // 2026-07-29
  // The desktop project has a fine pointer, so isMobile is false and the touch handlers are
  // inert: even a textbook rightward swipe leaves the row at the root. Desktop indents with Tab.
  test('a rightward swipe does not indent', async ({ page, request }) => {
    await layTree(request, SIBLINGS);
    await open(page, 2);

    await swipe(page, 'b', 90);

    await page.waitForTimeout(200);
    expect((await nodeById(request, 'b'))?.parentID).toBe(null);
  });
});
