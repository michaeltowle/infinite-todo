// Persistence: what reaches the Durable Object, and whether it can be lost.
//
// Every assertion reads the DO through GET /scratchpad/tree — never the DOM. The
// DOM renders from the client's optimistic mirror (nodesById), so it will happily
// show you text that never left the browser. That gap is the entire bug class this
// file exists to catch, and a DOM assertion would be blind to all of it.
//
// Nothing here pins the debounce. A test asserting "not saved yet after 100ms"
// would be pinning a mechanism we intend to replace, and would break the moment
// writes move onto a socket. These assert only that the user's edit is durable,
// which stays true under any transport.
//
// Enter lives here rather than in a suite of its own: the only thing about it that
// can silently break is whether it saves. Same for Tab.

import { test, expect } from '@playwright/test';
import { layTree, node, nodeById, open, readTree } from './helpers';

const PAST_DEBOUNCE = 700; // > DEBOUNCE_MS (400) in client-main

// ─── What reaches the store ──────────────────────────────────────────────────

// 2026-07-12
// The baseline: type, let the debounce fire, and the text is in the DO. If this
// breaks, nothing below it means anything.
test('typing persists', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('buy milk');
  await page.waitForTimeout(PAST_DEBOUNCE);

  expect((await nodeById(request, 'a'))?.keyboardText).toBe('buy milk');
});

// 2026-07-12
// Checking a box commits straight away — the toggle path has no debounce, unlike
// typing. Two roots so that checking one doesn't complete the whole document and
// drag seedIfEmpty into the picture.
test('checking a box persists', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'first'),
    node('b', null, 2, false, 'second'),
  ]);
  await open(page, 2);

  await page.locator('button[data-id="a"]').click();

  await expect.poll(async () => (await nodeById(request, 'a'))?.checked).toBe(true);
});

// 2026-07-12
// Backspace on an empty line removes the node from the store, not just from the
// screen. The mirror would look identical either way.
test('backspace on an empty line deletes the node from the store', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('e', null, 2, false, ''),
  ]);
  await open(page, 2);

  await page.locator('textarea[data-id="e"]').click();
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (await readTree(request)).map((n) => n.id)).toEqual(['a']);
});

// 2026-07-23
// Enter makes a new line in the DOM but does NOT persist it while it is empty — an empty todo is
// never written to the DO (item 4). Typing into it is what mints the `create`; the node then
// lands parented and positioned where the walk expects, unchecked, carrying its text.
test('Enter persists the new line only once it has text', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.press('End'); // caret at 0 would insert ABOVE instead
  await page.keyboard.press('Enter');
  await page.waitForTimeout(PAST_DEBOUNCE); // even past the debounce, the empty line stays unwritten

  await expect(page.locator('.todo-row')).toHaveCount(2); // on screen
  expect((await readTree(request)).length).toBe(1); // but not in the store

  await page.keyboard.type('second line');
  await page.waitForTimeout(PAST_DEBOUNCE);

  await expect.poll(async () => (await readTree(request)).length).toBe(2);
  const fresh = (await readTree(request)).find((n) => n.id !== 'a')!;
  expect(fresh).toMatchObject({ parentID: null, checked: false, keyboardText: 'second line' });
  expect(fresh.position).toBeGreaterThan(1); // below 'alpha', which sits at 1
});

// 2026-07-23
// The flip side of text-triggered creation: a new empty line abandoned before it is typed into
// costs the DO nothing. Enter then Backspace removes it from the DOM, and since it was never
// persisted there is no delete to send and nothing new in the store.
test('an untyped new line is never persisted, even through delete', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // new empty line below (DOM-only)
  await expect(page.locator('.todo-row')).toHaveCount(2);

  await page.keyboard.press('Backspace'); // remove the still-empty new line
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await page.waitForTimeout(PAST_DEBOUNCE);

  expect((await readTree(request)).map((n) => n.id)).toEqual(['a']);
});

// 2026-07-12
// Tab rewrites treePlacement (parentID + position) and that reaches the store.
// Indenting gets no suite of its own because this is the only way it can quietly
// break — on screen a failed indent is obvious, in the DO it is not.
test('Tab persists the new treePlacement', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'first'),
    node('b', null, 2, false, 'second'),
  ]);
  await open(page, 2);

  await page.locator('textarea[data-id="b"]').click();
  await page.keyboard.press('Tab');

  await expect.poll(async () => (await nodeById(request, 'b'))?.parentID).toBe('a');
});

// 2026-07-12
// The round-trip the user actually cares about, and the one place a DOM assertion
// is legitimate — it is asserting what came back OUT of the DO, not what the
// mirror thinks.
test('typed text survives a reload', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('buy milk');
  await page.waitForTimeout(PAST_DEBOUNCE);

  await page.reload();

  await expect(page.locator('textarea[data-id="a"]')).toHaveValue('buy milk');
});

// 2026-07-23
// Checking the last open box completes the plan (it archives), and a fresh blank seed line takes
// the page's place in the DOM. That seed is DOM-only — an empty line is never written to the DO
// (item 4) — so the store still holds only the original node. Typing into the seed is what finally
// persists it.
test('the auto-seeded blank line is not persisted until typed', async ({ page, request }) => {
  await layTree(request, [node('solo', null, 1, false, 'last one')]);
  await open(page, 1);

  await page.locator('button[data-id="solo"]').click();
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await page.waitForTimeout(PAST_DEBOUNCE);

  // The seed shows on screen but has not reached the store.
  expect((await readTree(request)).map((n) => n.id)).toEqual(['solo']);

  // Typing into it mints the create.
  await page.locator('#todo-container textarea').first().click();
  await page.keyboard.type('next thing');
  await page.waitForTimeout(PAST_DEBOUNCE);

  const seeded = (await readTree(request)).find((n) => n.id !== 'solo')!;
  expect(seeded).toMatchObject({ parentID: null, checked: false, keyboardText: 'next thing' });
});

// ─── What can be lost ────────────────────────────────────────────────────────

// 2026-07-12
// Type a line and shut the laptop. The text is sitting in a setTimeout that dies
// with the page, so unless something flushes it on the way out it is gone for good
// — and the screen showed it the whole time, because the mirror had it.
test('text typed but not yet saved survives the page going away', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('buy milk');
  await page.close(); // no wait: the debounce has not fired

  await expect.poll(async () => (await nodeById(request, 'a'))?.keyboardText).toBe('buy milk');
});

// 2026-07-23
// The same loss, reached the way it actually happens: type a todo, press Enter, walk away. The
// text of the line Enter fired from is still parked on its debounce timer, so it is the line at
// risk — flushOnExit must beacon it out. (The new empty line Enter made is DOM-only and empty, so
// there is nothing of it to lose.)
test('text typed and followed by Enter survives the page going away', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('buy milk');
  await page.keyboard.press('Enter');
  await page.close();

  await expect.poll(async () => (await nodeById(request, 'a'))?.keyboardText).toBe('buy milk');
});

// 2026-07-23
// A new node's text now travels WITH its create: typing an unsaved line materializes it into a
// single `create` (item 4), so the old "edit overtakes create" race is structurally gone. This
// pins the property that replaced it — hold that create back on the wire for 2s and, once it
// finally lands, the node is there with its text intact, nothing dropped or reordered.
test('an edit cannot overtake the create of the node it edits', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);

  await page.route('**/scratchpad/mutations', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('"create"')) await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // create — held on the wire for 2s
  await page.keyboard.type('second line'); // edit on the new node — debounced 400ms
  await page.waitForTimeout(PAST_DEBOUNCE);

  await expect
    .poll(async () => (await readTree(request)).map((n) => n.keyboardText).sort(), {
      timeout: 10_000,
    })
    .toEqual(['alpha', 'second line']);
});

// 2026-07-12
// A mutations POST that fails is currently swallowed whole — postMutations ends in
// .catch(() => {}), so there is no retry and no signal of any kind. Kill the first
// POST and the edit must still make it, on a later attempt.
test('a mutation whose POST fails is retried, not dropped', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  let killedOne = false;
  await page.route('**/scratchpad/mutations', async (route) => {
    if (!killedOne) {
      killedOne = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('buy milk');

  await expect
    .poll(async () => (await nodeById(request, 'a'))?.keyboardText, { timeout: 10_000 })
    .toBe('buy milk');
});
