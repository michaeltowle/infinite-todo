// Mobile de-dent gesture: on a touch device (no Tab key), a period typed with the caret at the
// very start of a line outdents it instead of inserting a '.'. Everything here turns on two
// facts — the pointer is coarse (isMobile in client-main) and the caret sits at column 0 — so
// each test isolates one of them. Persistence assertions read the Durable Object through the
// helpers; DOM assertions read the optimistic mirror, and are called out where used.

import { test, expect, devices } from '@playwright/test';
import { layTree, node, nodeById, open, putCaret } from './helpers';

// The iPhone 13 profile — Mike's one reference mobile screen (CLAUDE.md) — minus its
// defaultBrowserType: our config runs chromium only, and changing browser type inside a
// describe forces a new worker (Playwright rejects it). What we actually need survives the
// strip: the iPhone 13 viewport plus hasTouch/isMobile, which make (pointer: coarse) match.
const { defaultBrowserType: _webkit, ...IPHONE_13 } = devices['iPhone 13'];

// A parent with one child, the minimal shape an outdent needs.
const NESTED = [
  node('p', null, 1, false, 'parent'),
  node('k', 'p', 1, false, 'child'),
];

test.describe('on mobile (coarse pointer)', () => {
  // iPhone 13: a touch device with no hardware keyboard, so matchMedia('(pointer: coarse)')
  // matches — the signal client-main reads.
  test.use(IPHONE_13);

  // 2026-07-22
  // The gesture itself: caret at column 0 of an indented line, type a period, and the line
  // outdents to the root (parentID null in the DO) — with NO period inserted, and the caret
  // held at the start of the same line. The precondition assert pins the emulation dependency:
  // if the coarse-pointer signal ever stops matching, this fails loudly and on purpose.
  test('period at line start outdents the line and inserts no period', async ({ page, request }) => {
    await layTree(request, NESTED);
    await open(page, 2);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    await putCaret(page, 'k', 0);
    await page.keyboard.type('.');

    await expect.poll(async () => (await nodeById(request, 'k'))?.parentID).toBe(null);
    // The '.' was swallowed — the text is untouched — and the caret stayed at column 0.
    expect(await page.locator('textarea[data-id="k"]').inputValue()).toBe('child');
    expect(await page.evaluate(() => {
      const el = document.activeElement as HTMLTextAreaElement;
      return { id: el?.dataset?.id, start: el?.selectionStart };
    })).toMatchObject({ id: 'k', start: 0 });
  });

  // 2026-07-22
  // A root line has nothing to outdent into, so the period must type normally — otherwise a
  // line could never begin with one. The '.' both shows in the mirror and reaches the DO, and
  // the node stays at the root.
  test('period at the start of a root line types a literal period', async ({ page, request }) => {
    await layTree(request, [node('a', null, 1, false, 'alpha')]);
    await open(page, 1);

    await putCaret(page, 'a', 0);
    await page.keyboard.type('.');

    expect(await page.locator('textarea[data-id="a"]').inputValue()).toBe('.alpha');
    await expect.poll(async () => (await nodeById(request, 'a'))?.keyboardText).toBe('.alpha');
    expect((await nodeById(request, 'a'))?.parentID).toBe(null); // still a root, no outdent
  });

  // 2026-07-22
  // The gesture is column-0 only. A period typed mid-line on an indented row is just a period —
  // the text gains it and the node keeps its parent.
  test('period mid-line types a literal period and does not outdent', async ({ page, request }) => {
    await layTree(request, NESTED);
    await open(page, 2);

    await putCaret(page, 'k', 2); // between 'ch' and 'ild'
    await page.keyboard.type('.');

    expect(await page.locator('textarea[data-id="k"]').inputValue()).toBe('ch.ild');
    await expect.poll(async () => (await nodeById(request, 'k'))?.keyboardText).toBe('ch.ild');
    expect((await nodeById(request, 'k'))?.parentID).toBe('p'); // still under 'p', no outdent
  });
});

test.describe('on desktop (fine pointer)', () => {
  // 2026-07-22
  // The desktop project has a fine pointer, so isMobile is false and the beforeinput handler
  // is inert: a period at column 0 of an indented line is a literal period, and the line keeps
  // its parent. Desktop outdents with Shift+Tab, not this gesture.
  test('period at line start types a literal period and does not outdent', async ({ page, request }) => {
    await layTree(request, NESTED);
    await open(page, 2);

    await putCaret(page, 'k', 0);
    await page.keyboard.type('.');

    expect(await page.locator('textarea[data-id="k"]').inputValue()).toBe('.child');
    await expect.poll(async () => (await nodeById(request, 'k'))?.keyboardText).toBe('.child');
    expect((await nodeById(request, 'k'))?.parentID).toBe('p'); // still under 'p'
  });
});
