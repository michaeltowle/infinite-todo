// Shared by the spec files: lay down a known tree, open the page on it, and read
// the Durable Object back. Not a spec — Playwright's default match is *.spec.ts,
// so nothing here is collected as a test.

import { expect, type Page, type APIRequestContext } from '@playwright/test';

// The stored fields of a todo. Mirrors the Todo in src/shared-types.d.ts, which
// the test project does not compile against.
export type StoredNode = {
  id: string;
  parentID: string | null;
  position: number;
  checked: boolean;
  keyboardText: string;
  hideUntil?: string | null;
};

// hideUntil is trailing and optional: the great majority of trees under test are not
// bucketed, and every spec written before buckets existed still reads correctly.
export const node = (
  id: string,
  parentID: string | null,
  position: number,
  checked: boolean,
  keyboardText: string,
  hideUntil: string | null = null,
): StoredNode => ({ id, parentID, position, checked, keyboardText, hideUntil });

// Wipe the tree and lay down a known one. Goes through the real mutations API —
// no test-only route, no direct storage access, nothing that exists in production
// solely to serve tests.
//
// A *known* tree, not merely an empty one: seedIfEmpty() drops a blank todo into an
// empty tree, so "empty" is not a stable starting state. Always wipe, then seed,
// then load the page.
export async function layTree(request: APIRequestContext, nodes: StoredNode[]) {
  const existing = await readTree(request);
  if (existing.length) {
    await request.post('/scratchpad/mutations', {
      data: existing.map((n) => ({ op: 'delete', id: n.id })),
    });
  }
  if (nodes.length) {
    await request.post('/scratchpad/mutations', {
      data: nodes.map((n) => ({ op: 'create', ...n })),
    });
  }
}

export async function open(page: Page, expectedRows: number) {
  await page.goto('/scratchpad');
  await expect(page.locator('.todo-row')).toHaveCount(expectedRows);
}

// The Durable Object's own view of the tree — the source of truth, and the only
// thing a persistence assertion is allowed to look at. Deliberately goes through
// `request` rather than the page, so page.route() interception can't touch it.
export async function readTree(request: APIRequestContext): Promise<StoredNode[]> {
  const body: { nodes: StoredNode[] } = await (await request.get('/scratchpad/tree')).json();
  return body.nodes;
}

export async function nodeById(request: APIRequestContext, id: string) {
  return (await readTree(request)).find((n) => n.id === id);
}

// ─── The cursor, read straight off the DOM ───────────────────────────────────
// The app has no cursor object: "the cursor" is exactly two DOM facts, focus
// (document.activeElement) and caret (a collapsed selection range).

export async function cursor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return {
      tag: el ? el.tagName : null,
      id: el && el.dataset ? (el.dataset.id ?? null) : null,
      start: el && typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: el && typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
    };
  });
}

export const caretOf = (page: Page, id: string) =>
  page.evaluate(
    (id) => (document.querySelector(`input[data-id="${id}"]`) as HTMLInputElement).selectionStart,
    id,
  );

// Put the caret somewhere as a starting condition. Deliberately does NOT go through
// the app's own code paths — otherwise a test would be asserting on the thing it used
// to set up.
export async function putCaret(page: Page, id: string, col: number) {
  await page.evaluate(
    ({ id, col }) => {
      const el = document.querySelector(`input[data-id="${id}"]`) as HTMLInputElement;
      el.focus();
      el.setSelectionRange(col, col);
    },
    { id, col },
  );
}

// Stamp a live DOM node so we can tell afterwards whether render() replaced it.
// render() does list.textContent = '' and rebuilds every row, so a surviving stamp
// proves no re-render happened — and therefore that focus and caret could not have
// been destroyed.
export async function stamp(page: Page, id: string) {
  await page.evaluate((id) => {
    (document.querySelector(`input[data-id="${id}"]`) as HTMLInputElement & {
      _stamp?: number;
    })._stamp = 1;
  }, id);
}

export async function stampSurvived(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`input[data-id="${id}"]`) as
      | (HTMLInputElement & { _stamp?: number })
      | null;
    return !!(el && el._stamp);
  }, id);
}
