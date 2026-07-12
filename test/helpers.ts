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
};

export const node = (
  id: string,
  parentID: string | null,
  position: number,
  checked: boolean,
  keyboardText: string,
): StoredNode => ({ id, parentID, position, checked, keyboardText });

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
