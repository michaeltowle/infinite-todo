// Live sync: a change made on one device shows up on the others, with nobody's
// cursor getting hurt.
//
// Two real pages in one browser context, both talking to the single TodoTree DO —
// that IS the multi-device case, since the DO is global (idFromName('root')) and
// neither page knows the other exists. No reload anywhere in this file: if a change
// only appears after page.reload(), the feature does not work.
//
// Where a test needs another device's edit to land at an exact moment, it POSTs the
// mutation directly under its own tabID rather than driving a second UI. That is not
// a test-only backdoor — it is the same public endpoint the client uses, and it buys
// deterministic timing that racing two browsers cannot.

import { test, expect } from '@playwright/test';
import {
  caretOf,
  cursor,
  layTree,
  node,
  open,
  putCaret,
  stamp,
  stampSurvived,
} from './helpers';

// A mutation from "another device": a real POST, tagged with a tabID that belongs to
// no open tab, so the DO fans it out to every socket.
const ELSEWHERE = '/scratchpad/mutations?tab=another-device';

// ─── Changes arrive ──────────────────────────────────────────────────────────

// 2026-07-12
// The bug that started this: check a box on the phone, watch the laptop. The parent
// stays unchecked so the tree is not fully checked and cannot vanish from the walk.
test('a box checked on one device shows up on the other', async ({ page, context, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent line'),
    node('k', 'p', 1, false, 'child line'),
  ]);
  await open(page, 2);
  const other = await context.newPage();
  await open(other, 2);

  await other.locator('button[data-id="k"]').click();

  await expect(page.locator('.todo-row[data-checked="1"] textarea[data-id="k"]')).toHaveCount(1);
});

// 2026-07-12
// Text typed on one device reaches the other once its debounce fires. Note the
// receiving page has focus sitting in this very input (boot focuses the last one),
// and must still accept the text — it has no unsent edit of its own to protect.
test('text typed on one device shows up on the other', async ({ page, context, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);
  const other = await context.newPage();
  await open(other, 1);

  await other.locator('textarea[data-id="a"]').click();
  await other.keyboard.type('buy milk');

  await expect(page.locator('textarea[data-id="a"]')).toHaveValue('buy milk');
});

// 2026-07-23
// A line created with Enter appears on the other device once it holds text — an EMPTY new line
// is deliberately local-only (item 4) and has nothing to broadcast, so the other device sees it
// only once its create materializes.
test('a new line created on one device appears on the other, once it has text', async ({
  page,
  context,
  request,
}) => {
  await layTree(request, [node('a', null, 1, false, 'alpha')]);
  await open(page, 1);
  const other = await context.newPage();
  await open(other, 1);

  await other.locator('textarea[data-id="a"]').click();
  await other.keyboard.press('End'); // caret at 0 would insert ABOVE
  await other.keyboard.press('Enter');
  await other.keyboard.type('bravo'); // materializes the create; nothing to sync before this

  await expect(page.locator('.todo-row')).toHaveCount(2);
});

// 2026-07-12
// An indent is a treePlacement change, and the receiving device must re-derive depth
// from it — so the assertion is on the rendered indent, not just on the node count.
test('an indent on one device appears on the other', async ({ page, context, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'first'),
    node('b', null, 2, false, 'second'),
  ]);
  await open(page, 2);
  const other = await context.newPage();
  await open(other, 2);

  await other.locator('textarea[data-id="b"]').click();
  await other.keyboard.press('Tab');

  await expect(page.locator('.todo-row').nth(1)).toHaveCSS('margin-left', '28px'); // one INDENT
});

// 2026-07-12
// A deletion propagates too — the row goes away on the other device.
test('a line deleted on one device disappears on the other', async ({
  page,
  context,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('e', null, 2, false, ''),
  ]);
  await open(page, 2);
  const other = await context.newPage();
  await open(other, 2);

  await other.locator('textarea[data-id="e"]').click();
  await other.keyboard.press('Backspace');

  await expect(page.locator('.todo-row')).toHaveCount(1);
});

// ─── Nobody's cursor gets hurt ───────────────────────────────────────────────

// 2026-07-21
// The whole reason the cursor spec had to exist before this one. A remote change forces
// render(), which rebuilds every row from scratch and would annihilate focus and caret — so
// applyRemote routes through `pending`, and the caret comes back exactly where it was, on a
// line the remote change never touched.
//
// The remote edit is re-posted until it lands: this page's socket connects a beat after boot,
// and a change posted before it is live is missed (the first connect deliberately does not
// refetch, so it cannot clobber optimistic local edits). Re-posting the same edit is
// idempotent and simply proves the socket is live; the invariant under test — the local caret
// does not move when a remote change arrives — is unchanged.
test('a remote change does not move the local caret', async ({ page, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent line'),
    node('k', 'p', 1, false, 'child line'),
  ]);
  await open(page, 2);
  await putCaret(page, 'p', 3);

  await expect(async () => {
    await request.post(ELSEWHERE, { data: [{ op: 'edit', id: 'k', checked: true }] });
    await expect(page.locator('.todo-row[data-checked="1"] textarea[data-id="k"]')).toHaveCount(
      1,
      { timeout: 800 },
    );
  }).toPass();

  expect(await cursor(page)).toMatchObject({ id: 'p', start: 3, end: 3 });
});

// 2026-07-12
// Type a word, and before the debounce can flush it, another device's text for that
// same line lands. Ours is unsent — a live debounce timer says so — so it must not be
// clobbered mid-word. The rest of a remote mutation still applies; only the text is
// held back.
test('a remote edit does not overwrite the line you are typing in', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await page.keyboard.type('mine'); // now parked on the debounce timer, unsent

  await request.post(ELSEWHERE, { data: [{ op: 'edit', id: 'a', keyboardText: 'theirs' }] });

  await expect(page.locator('textarea[data-id="a"]')).toHaveValue('mine');
});

// 2026-07-12
// The DO must not echo a batch back to the tab that sent it: that tab already applied
// it optimistically, and re-applying would cost it a render — and a render destroys
// the input node, the focus and the caret, mid-word. The stamp proves the input node
// survived, which proves no render happened.
test('your own write is not echoed back to you', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '')]);
  await open(page, 1);

  await page.locator('textarea[data-id="a"]').click();
  await stamp(page, 'a');

  await page.keyboard.type('buy milk');
  await page.waitForTimeout(700); // > DEBOUNCE_MS: the POST lands and the DO fans out

  expect(await stampSurvived(page, 'a')).toBe(true); // no re-render
  expect(await caretOf(page, 'a')).toBe(8); // caret still at the end of what we typed
});
