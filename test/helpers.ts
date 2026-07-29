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
  date?: string | null;
  createdAt?: number;
  completedAt?: number | null;
  priority?: number | null;
};

// The stored fields of a plan. Mirrors Plan in src/shared-types.d.ts. createdAt is optional here
// so a spec that does not care when a plan was made can omit it (the DO stores 0 and the pill
// then shows no creation stamp); a creation-time spec passes an explicit epoch-ms value.
export type StoredPlan = {
  id: string;
  name: string;
  order: number;
  archived: boolean;
  createdAt?: number;
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
  date: string | null = null,
  createdAt = 0,
  completedAt: number | null = null,
  priority: number | null = null,
): StoredNode => ({
  id, parentID, position, checked, keyboardText, planID, date, createdAt, completedAt, priority,
});

export const plan = (
  id: string,
  name: string,
  order: number,
  archived = false,
  createdAt = 0,
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
    await request.post('/mutations', { data: dels });
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
    await request.post('/mutations', { data: creates });
  }
}

export async function open(page: Page, expectedRows: number) {
  await page.goto('/');
  await expect(page.locator('.todo-row')).toHaveCount(expectedRows);
}

// The Durable Object's own view — the source of truth, and the only thing a persistence
// assertion is allowed to look at. Deliberately goes through `request` rather than the page,
// so page.route() interception can't touch it.
type Tree = { nodes: StoredNode[]; plans: StoredPlan[] };
async function readAll(request: APIRequestContext): Promise<Tree> {
  const body: Partial<Tree> = await (await request.get('/tree')).json();
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

// ─── Touch gestures ──────────────────────────────────────────────────────────
// Playwright's touchscreen API can tap but not swipe, so a swipe is dispatched by hand:
// touchstart on the row, a few touchmove steps, then touchend. The client's handler reads
// nothing but touches[0].clientX/clientY and the event target, so synthetic Touch objects
// carry it faithfully — what this can NOT exercise is the browser's own gesture arbitration
// (native scrolling, the iOS edge-swipe), which is why the gesture still wants an eyeball on
// a real device.
//
// `dx`/`dy` are the total displacement from the start point; `from` overrides the start
// coordinates (used to sit the gesture inside the browser's back-swipe edge band).
export async function swipe(
  page: Page,
  id: string,
  dx: number,
  dy = 0,
  from?: { x: number; y: number },
) {
  await page.evaluate(
    ({ id, dx, dy, from }) => {
      const ta = document.querySelector(`textarea[data-id="${id}"]`) as HTMLTextAreaElement;
      const box = ta.getBoundingClientRect();
      const x0 = from ? from.x : box.left + 10;
      const y0 = from ? from.y : box.top + box.height / 2;

      const at = (x: number, y: number) =>
        new Touch({ identifier: 1, target: ta, clientX: x, clientY: y });
      const fire = (type: string, x: number, y: number) => {
        const touches = type === 'touchend' ? [] : [at(x, y)];
        ta.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches,
            changedTouches: [at(x, y)],
          }),
        );
      };

      fire('touchstart', x0, y0);
      // Several steps, so a gesture that only crosses the threshold part-way through is
      // recognised at the same point a real finger would cross it.
      for (const step of [0.34, 0.67, 1]) {
        fire('touchmove', x0 + dx * step, y0 + dy * step);
      }
      fire('touchend', x0 + dx, y0 + dy);
    },
    { id, dx, dy, from },
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
