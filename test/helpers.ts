// Shared by the spec files: lay down a known tree + plans, open the page on it, and read
// the Durable Object back. Not a spec — Playwright's default match is *.spec.ts, so nothing
// here is collected as a test.

import { expect, type Page, type APIRequestContext } from '@playwright/test';

// The stored fields of a todo. Mirrors the Todo in src/shared-types.d.ts, which the test
// project does not compile against.
export type StoredNode = {
  id: string;
  parentID: string | null;
  position: number;
  checked: boolean;
  keyboardText: string;
  planID?: string | null;
};

// The stored fields of a plan. Mirrors Plan in src/shared-types.d.ts. createdAt is optional here
// so a spec that does not care about a plan's age can omit it (the DO stores "" and the pill then
// shows no age); a days-alive spec passes an explicit YYYY-MM-DD.
export type StoredPlan = {
  id: string;
  name: string;
  order: number;
  archived: boolean;
  createdAt?: string;
};

// planID is trailing and optional. layTree() sweeps every ROOT (parentID null) that does not
// name a plan into the default test plan, so a spec that only cares about tree shape need not
// think about plans; a child keeps its null (plan membership is a root property).
export const node = (
  id: string,
  parentID: string | null,
  position: number,
  checked: boolean,
  keyboardText: string,
  planID: string | null = null,
): StoredNode => ({ id, parentID, position, checked, keyboardText, planID });

export const plan = (
  id: string,
  name: string,
  order: number,
  archived = false,
  createdAt = '',
): StoredPlan => ({ id, name, order, archived, createdAt });

// The plan layTree() seeds when a spec does not supply its own.
export const TEST_PLAN = 'test-plan';

// Wipe the store and lay down a known tree (and plans). Goes through the real mutations API —
// no test-only route, no direct storage access.
//
// When `plans` is omitted, one default plan (TEST_PLAN) is created and every root todo that
// did not name a plan is swept into it, so the landing page has a plan to show. Pass an
// explicit list to control the plans, or `plans: []` to lay a *legacy* state — nodes but no
// plans — the shape the boot migration is there to rescue.
export async function layTree(
  request: APIRequestContext,
  nodes: StoredNode[],
  plans?: StoredPlan[],
) {
  const existing = await readAll(request);
  const dels = [
    ...existing.nodes.map((n) => ({ op: 'delete', id: n.id })),
    ...existing.plans.map((p) => ({ op: 'delete-plan', id: p.id })),
  ];
  if (dels.length) {
    await request.post('/scratchpad/mutations', { data: dels });
  }

  const planList = plans ?? [plan(TEST_PLAN, 'Test Plan', 1)];
  const fallback = planList.length ? planList[0].id : null;
  const creates = [
    ...planList.map((p) => ({ op: 'create-plan', ...p })),
    ...nodes.map((n) => ({
      op: 'create',
      ...n,
      planID: n.parentID == null ? (n.planID ?? fallback) : (n.planID ?? null),
    })),
  ];
  if (creates.length) {
    await request.post('/scratchpad/mutations', { data: creates });
  }
}

export async function open(page: Page, expectedRows: number) {
  await page.goto('/scratchpad');
  await expect(page.locator('.todo-row')).toHaveCount(expectedRows);
}

// The Durable Object's own view — the source of truth, and the only thing a persistence
// assertion is allowed to look at. Deliberately goes through `request` rather than the page,
// so page.route() interception can't touch it.
type Tree = { nodes: StoredNode[]; plans: StoredPlan[] };
async function readAll(request: APIRequestContext): Promise<Tree> {
  const body: Partial<Tree> = await (await request.get('/scratchpad/tree')).json();
  return { nodes: body.nodes ?? [], plans: body.plans ?? [] };
}

export async function readTree(request: APIRequestContext): Promise<StoredNode[]> {
  return (await readAll(request)).nodes;
}

export async function readPlans(request: APIRequestContext): Promise<StoredPlan[]> {
  return (await readAll(request)).plans;
}

export async function nodeById(request: APIRequestContext, id: string) {
  return (await readTree(request)).find((n) => n.id === id);
}

export async function planById(request: APIRequestContext, id: string) {
  return (await readPlans(request)).find((p) => p.id === id);
}

// ─── The cursor, read straight off the DOM ───────────────────────────────────
// The app has no cursor object: "the cursor" is exactly two DOM facts, focus
// (document.activeElement) and caret (a collapsed selection range).

export async function cursor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLTextAreaElement | null;
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
    (id) => (document.querySelector(`textarea[data-id="${id}"]`) as HTMLTextAreaElement).selectionStart,
    id,
  );

// Put the caret somewhere as a starting condition. Deliberately does NOT go through
// the app's own code paths — otherwise a test would be asserting on the thing it used
// to set up.
export async function putCaret(page: Page, id: string, col: number) {
  await page.evaluate(
    ({ id, col }) => {
      const el = document.querySelector(`textarea[data-id="${id}"]`) as HTMLTextAreaElement;
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
    (document.querySelector(`textarea[data-id="${id}"]`) as HTMLTextAreaElement & {
      _stamp?: number;
    })._stamp = 1;
  }, id);
}

export async function stampSurvived(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`textarea[data-id="${id}"]`) as
      | (HTMLTextAreaElement & { _stamp?: number })
      | null;
    return !!(el && el._stamp);
  }, id);
}
