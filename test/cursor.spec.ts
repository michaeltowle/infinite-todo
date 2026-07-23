// Cursor behaviour: where the caret and focus land. Nothing else.
//
// The app has no cursor object. "The cursor" is exactly two independent DOM facts,
// and every assertion below reduces to one or both:
//
//   focus  = document.activeElement — which input receives keystrokes
//   caret  = input.selectionStart === input.selectionEnd (a collapsed range)
//
// They are orthogonal: an input can be focused with its caret anywhere, and a
// non-focused input still reports a selectionStart.
//
// These are characterization tests — they pin behaviour that already exists, so a
// future change to the keystroke path (optparse, tagging, new node types) has to
// say out loud which rule it is breaking. Structural commands (Enter, Tab) are out
// of scope and belong in their own spec; Backspace appears only where its whole
// purpose is deciding where the caret lands.

import { test, expect } from '@playwright/test';
import { caretOf, cursor, layTree, node, open, putCaret, stamp, stampSurvived } from './helpers';

// Three roots at the same depth, with deliberately different lengths.
const FLAT = [
  node('a', null, 1, false, 'alpha'), //         len 5
  node('b', null, 2, false, 'bravo charlie'), // len 13
  node('c', null, 3, false, 'd'), //             len 1
];

// ─── Arrow navigation ────────────────────────────────────────────────────────

// 2026-07-12
// ArrowUp from a line with one above it moves focus to that line. Also the proof
// that the handler calls preventDefault: the browser's native ArrowUp inside a
// single-line input just collapses the caret to 0, it never moves focus to a
// different element.
test('ArrowUp moves to the line above', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'b', 2);

  await page.keyboard.press('ArrowUp');

  expect((await cursor(page)).id).toBe('a');
});

// 2026-07-12
// ArrowDown from a line with one below it moves focus to that line.
test('ArrowDown moves to the line below', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'b', 2);

  await page.keyboard.press('ArrowDown');

  expect((await cursor(page)).id).toBe('c');
});

// 2026-07-12
// There is no line above the first, so rather than do nothing, onArrow snaps the
// caret to the very start of the line it is already on. Focus does not move.
test('ArrowUp on the first line snaps the caret to column 0', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'a', 3);

  await page.keyboard.press('ArrowUp');

  expect(await cursor(page)).toMatchObject({ id: 'a', start: 0, end: 0 });
});

// 2026-07-12
// Mirror of the above: no line below the last, so the caret snaps to end-of-line
// instead of moving. Focus does not move.
test('ArrowDown on the last line snaps the caret to end of line', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'c', 0);

  await page.keyboard.press('ArrowDown');

  expect(await cursor(page)).toMatchObject({ id: 'c', start: 1, end: 1 }); // 'd'.length
});

// 2026-07-12
// The point of moveCaret(): keep the caret in the same place *on screen* when the
// two lines are indented differently. A child sits INDENT px to the right, so to
// hold the same screen x on its outdented parent the caret must land at a LATER
// column. Identical text on both lines isolates indent as the only variable.
test('arrowing across an indent change preserves the caret visual x-position', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('p', null, 1, false, 'the quick brown fox'),
    node('k', 'p', 1, false, 'the quick brown fox'),
  ]);
  await open(page, 2);
  await putCaret(page, 'k', 8);

  await page.keyboard.press('ArrowUp');

  const cur = await cursor(page);
  expect(cur.id).toBe('p');
  // Same text, so a naive implementation would land on column 8. The indent shift
  // must push it further right.
  expect(cur.start).toBeGreaterThan(8);
});

// 2026-07-12
// Arrowing into a line too short to hold the current column clamps to that line's
// end rather than overshooting or throwing.
test('ArrowDown into a shorter line clamps the caret to its length', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'b', 13); // end of 'bravo charlie'

  await page.keyboard.press('ArrowDown');

  expect(await cursor(page)).toMatchObject({ id: 'c', start: 1 }); // 'd' has one column
});

// 2026-07-12
// An empty line has exactly one column, so the caret has nowhere to go but 0.
test('ArrowDown into an empty line puts the caret at column 0', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, 'alpha'), node('e', null, 2, false, '')]);
  await open(page, 2);
  await putCaret(page, 'a', 3);

  await page.keyboard.press('ArrowDown');

  expect(await cursor(page)).toMatchObject({ id: 'e', start: 0 });
});

// 2026-07-12
// Arrows follow document order (the flattened pre-order walk), not sibling order —
// so they descend into children and climb back out to the next root.
test('arrows traverse nested children in document order', async ({ page, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent'),
    node('k1', 'p', 1, false, 'child one'),
    node('k2', 'p', 2, false, 'child two'),
    node('q', null, 2, false, 'next root'),
  ]);
  await open(page, 4);
  await putCaret(page, 'p', 0);

  await page.keyboard.press('ArrowDown');
  expect((await cursor(page)).id).toBe('k1');
  await page.keyboard.press('ArrowDown');
  expect((await cursor(page)).id).toBe('k2');
  await page.keyboard.press('ArrowDown');
  expect((await cursor(page)).id).toBe('q');
  await page.keyboard.press('ArrowUp');
  expect((await cursor(page)).id).toBe('k2');
});

// 2026-07-12
// Every real editor keeps a "desired column": pass through a short line and the
// caret returns to the original column on the next long one. onArrow holds one (as
// a desired *x*, since it measures in pixels to survive indent changes) for as long
// as the arrows keep coming, so a short line clamps where the caret lands without
// narrowing the rest of the run. Was a KNOWN FAILURE — onArrow used to re-measure
// from the caret's current position each time, letting one short line narrow the
// column permanently.
test('consecutive arrows restore the desired column after passing a short line', async ({
  page,
  request,
}) => {
  await layTree(request, [
    node('a', null, 1, false, 'the quick brown fox'), // len 19
    node('b', null, 2, false, 'hi'), //                 len 2 — the short line
    node('c', null, 3, false, 'the lazy dog jumps'), // len 18
  ]);
  await open(page, 3);
  await putCaret(page, 'a', 12);

  await page.keyboard.press('ArrowDown'); // onto 'hi' — must clamp to 2
  expect((await cursor(page)).id).toBe('b');

  await page.keyboard.press('ArrowDown'); // onto the long line — should restore ~12

  const cur = await cursor(page);
  expect(cur.id).toBe('c');
  expect(cur.start).toBeGreaterThanOrEqual(10); // before the fix it landed around column 2
});

// 2026-07-22
// An empty line has no native "leftward" to go to (the caret is already at column 0
// with nothing to its left), so ArrowLeft instead treats the previous line as if it
// were a continuation of the same text and drops the caret at its very end.
test('ArrowLeft on an empty line jumps to the end of a non-empty previous line', async ({
  page,
  request,
}) => {
  await layTree(request, [node('a', null, 1, false, 'alpha'), node('e', null, 2, false, '')]);
  await open(page, 2);
  await putCaret(page, 'e', 0);

  await page.keyboard.press('ArrowLeft');

  expect(await cursor(page)).toMatchObject({ id: 'a', start: 5, end: 5 }); // end of 'alpha'
});

// 2026-07-22
// The previous-line jump is conditioned on that line actually carrying text — an empty
// line above stays a plain, native ArrowLeft (caret already at 0, nothing moves; focus
// stays put).
test('ArrowLeft on an empty line does nothing when the previous line is also empty', async ({
  page,
  request,
}) => {
  await layTree(request, [node('a', null, 1, false, ''), node('e', null, 2, false, '')]);
  await open(page, 2);
  await putCaret(page, 'e', 0);

  await page.keyboard.press('ArrowLeft');

  expect(await cursor(page)).toMatchObject({ id: 'e', start: 0, end: 0 });
});

// 2026-07-22
// The topmost line has no previous line at all, so ArrowLeft on an empty topmost line
// is a no-op rather than throwing on an out-of-range lookup.
test('ArrowLeft on an empty topmost line is a no-op', async ({ page, request }) => {
  await layTree(request, [node('solo', null, 1, false, '')]);
  await open(page, 1);
  await putCaret(page, 'solo', 0);

  await page.keyboard.press('ArrowLeft');

  expect(await cursor(page)).toMatchObject({ id: 'solo', start: 0, end: 0 });
});

// 2026-07-23
// Mirror of the empty-line ArrowLeft jump. A caret at the very END of a line that carries
// text has nowhere native to go on ArrowRight; when the next line is an empty todo, drop the
// caret onto it at column 0, as if the empty line were the continuation of this text.
test('ArrowRight at the end of a text line jumps into the next empty line', async ({
  page,
  request,
}) => {
  await layTree(request, [node('a', null, 1, false, 'alpha'), node('e', null, 2, false, '')]);
  await open(page, 2);
  await putCaret(page, 'a', 5); // end of 'alpha'

  await page.keyboard.press('ArrowRight');

  expect(await cursor(page)).toMatchObject({ id: 'e', start: 0, end: 0 });
});

// 2026-07-23
// The jump is conditioned on the NEXT line being empty. When it carries text, ArrowRight stays
// native: the caret is already at end-of-value, so nothing moves and focus stays on the line.
test('ArrowRight at the end of a text line does nothing when the next line has text', async ({
  page,
  request,
}) => {
  await layTree(request, [node('a', null, 1, false, 'alpha'), node('b', null, 2, false, 'bravo')]);
  await open(page, 2);
  await putCaret(page, 'a', 5); // end of 'alpha'

  await page.keyboard.press('ArrowRight');

  expect(await cursor(page)).toMatchObject({ id: 'a', start: 5, end: 5 });
});

// 2026-07-23
// The last line has no next line at all, so ArrowRight at its end is a no-op rather than
// throwing on an out-of-range lookup — the caret stays where it is.
test('ArrowRight at the end of the last line is a no-op', async ({ page, request }) => {
  await layTree(request, [node('solo', null, 1, false, 'hello')]);
  await open(page, 1);
  await putCaret(page, 'solo', 5); // end of 'hello'

  await page.keyboard.press('ArrowRight');

  expect(await cursor(page)).toMatchObject({ id: 'solo', start: 5, end: 5 });
});

// ─── Focus placement ─────────────────────────────────────────────────────────

// 2026-07-12
// On boot the client focuses the LAST visible input. It calls a bare .focus() with no
// setSelectionRange, so the column is not chosen by our code at all — it is the
// browser's default for a freshly focused input, which turns out to be end-of-value.
// The last line is deliberately long, so end-of-value can't be confused with some
// small fixed column. Pinning it because it is load-bearing and invisible: nothing in
// the source says "caret at end" here.
test('on load, focus lands on the last visible input, caret at end', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'),
    node('z', null, 2, false, 'the final line'), // len 14
  ]);
  await open(page, 2);

  expect(await cursor(page)).toMatchObject({ tag: 'TEXTAREA', id: 'z', start: 14, end: 14 });
});

// 2026-07-21
// blankFocus: mousedown anywhere that isn't an input, a checkbox, the title or a sidebar is
// treated as "put me back in the document" — it focuses the last input and drops the caret at
// its end, so clicking dead space below the list never leaves you with nowhere to type. The
// dead space now lives in #plan-page's bottom padding (the rows sit in #todo-container above).
test('mousedown on blank space focuses the last input with the caret at the end', async ({
  page,
  request,
}) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'a', 0);

  // Dead space inside #plan-page's bottom padding, below the rows.
  await page.locator('#plan-page').click({ position: { x: 200, y: 300 } });

  expect(await cursor(page)).toMatchObject({ id: 'c', start: 1, end: 1 }); // end of 'd'
});

// 2026-07-12
// blankFocus must NOT hijack a click that landed on an input — otherwise every click
// would slam the caret to end-of-line instead of where you clicked.
test('mousedown on an input is left alone by blankFocus', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);

  // Click near the far left of the long line.
  await page.locator('textarea[data-id="b"]').click({ position: { x: 3, y: 10 } });

  const cur = await cursor(page);
  expect(cur.id).toBe('b');
  expect(cur.start).toBeLessThan(3); // near the start, NOT slammed to 13
});

// 2026-07-12
// blankFocus also early-returns on a checkbox click. Pins where focus actually goes
// when you click a checkbox — the caret is NOT handed back to any input.
test('mousedown on a checkbox does not pull focus into an input', async ({ page, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent line'),
    node('k', 'p', 1, false, 'child line'),
  ]);
  await open(page, 2);
  await putCaret(page, 'p', 5);

  await page.locator('button[data-id="k"]').click();

  expect((await cursor(page)).tag).not.toBe('TEXTAREA');
});

// ─── Caret stability ─────────────────────────────────────────────────────────

// 2026-07-12
// Typing must never re-render: render() rebuilds every row from scratch, which would
// destroy the input node and annihilate the caret mid-word. onInput deliberately
// mutates the local mirror and debounces the write instead. The wait outruns
// DEBOUNCE_MS so the persist round-trip is included — that is where a stray render()
// would most plausibly creep in.
test('typing does not re-render, so the caret never jumps', async ({ page, request }) => {
  await layTree(request, FLAT);
  await open(page, 3);
  await putCaret(page, 'b', 5); // right after 'bravo'
  await stamp(page, 'b');

  await page.keyboard.type('ZZ');
  expect(await caretOf(page, 'b')).toBe(7);

  await page.waitForTimeout(700); // > DEBOUNCE_MS (400) — let the mutation POST land

  expect(await stampSurvived(page, 'b')).toBe(true); // no re-render
  expect(await caretOf(page, 'b')).toBe(7); // caret still mid-word
  expect((await cursor(page)).id).toBe('b');
});

// 2026-07-12
// Checking a box whose root tree is NOT thereby completed updates that one checkbox
// in place — no render() — so any caret sitting in another input survives untouched.
// (Focus itself moves to the clicked button; that is the previous test's business.)
test('toggling a checkbox in place leaves the caret untouched', async ({ page, request }) => {
  await layTree(request, [
    node('p', null, 1, false, 'parent line'),
    node('k', 'p', 1, false, 'child line'),
  ]);
  await open(page, 2);
  await putCaret(page, 'p', 5);
  await stamp(page, 'p');

  // Check the child. The parent stays unchecked, so the tree is not fully checked
  // and must not disappear.
  await page.locator('button[data-id="k"]').click();

  await expect(page.locator('.todo-row')).toHaveCount(2);
  expect(await stampSurvived(page, 'p')).toBe(true); // no re-render
  expect(await caretOf(page, 'p')).toBe(5); // caret preserved
});

// 2026-07-12
// Checking the last open box completes the whole tree, so walk() hides it, seedIfEmpty
// drops in a blank line, and render() rebuilds the DOM. Nothing set `pending`, so
// applyPending() no-ops and NOTHING ends up focused. Pinning today's behaviour: the
// user is left with a fresh blank line they cannot type into without clicking it.
// Flagged as a wart, not endorsed.
test('checking the last open box leaves nothing focused', async ({ page, request }) => {
  await layTree(request, [node('solo', null, 1, false, 'last one')]);
  await open(page, 1);

  await page.locator('button[data-id="solo"]').click();

  // The completed tree vanished and a blank line took its place.
  await expect(page.locator('.todo-row')).toHaveCount(1);
  expect(await page.locator('.todo-row textarea').inputValue()).toBe('');

  expect((await cursor(page)).tag).toBe('BODY'); // focus fell off the document
});

// 2026-07-12
// The `pending` mechanism, end to end. Focus and caret cannot survive render(), so a
// command that rebuilds the DOM must state its cursor target first: pending = {id, col},
// consumed exactly once by applyPending() at the end of render(). Backspace on an empty
// line is the cheapest way to drive it — its whole purpose is deciding where the caret
// lands afterwards (end of the line above).
test('caret is restored after a re-render via pending', async ({ page, request }) => {
  await layTree(request, [
    node('a', null, 1, false, 'alpha'), // len 5
    node('e', null, 2, false, ''), //      empty, childless, not first
  ]);
  await open(page, 2);
  await putCaret(page, 'e', 0);

  await page.keyboard.press('Backspace');

  await expect(page.locator('.todo-row')).toHaveCount(1);
  expect(await cursor(page)).toMatchObject({ id: 'a', start: 5, end: 5 }); // end of 'alpha'
});
