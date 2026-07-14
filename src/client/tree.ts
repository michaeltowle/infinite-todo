// Pure tree functions. Nothing in here touches the DOM, the network, or module
// state — every function takes the node map it should read. That is what makes
// them safe to call from the store, the renderer and the command layer alike,
// and what lets the DO's own tree walk stay a separate implementation without
// the two drifting into each other.

// Every node whose parent is parentID, in sibling order. The primitive the rest
// of this file is built from.
export function childrenOf(
  nodes: Map<string, Todo>,
  parentID: string | null,
): Todo[] {
  const p = parentID != null ? parentID : null;
  return [...nodes.values()]
    .filter((n) => (n.parentID != null ? n.parentID : null) === p)
    .sort(cmpNodes);
}

// A node's own row — its parent's children, which includes the node itself.
export function siblingsOf(nodes: Map<string, Todo>, node: Todo): Todo[] {
  return childrenOf(nodes, node.parentID);
}

// parentID → children, sorted. One pass, for callers that would otherwise run
// childrenOf() once per node.
export function childMap(nodes: Map<string, Todo>): Map<string | null, Todo[]> {
  const kids = new Map<string | null, Todo[]>();
  for (const n of nodes.values()) {
    const p = n.parentID != null ? n.parentID : null;
    const siblings = kids.get(p);
    if (siblings) siblings.push(n);
    else kids.set(p, [n]);
  }
  for (const arr of kids.values()) arr.sort(cmpNodes);
  return kids;
}

export function cmpNodes(a: Todo, b: Todo): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// True when `node` and every descendant is checked — the whole subtree is done.
// `kids` is an optional childMap(); pass one to reuse it across calls.
export function fullyChecked(
  nodes: Map<string, Todo>,
  node: Todo,
  kids?: Map<string | null, Todo[]>,
): boolean {
  const k = kids || childMap(nodes);
  if (!node.checked) return false;
  for (const c of k.get(node.id) || []) {
    if (!fullyChecked(nodes, c, k)) return false;
  }
  return true;
}

// Walk parent pointers up to the 0-depth node that roots `id`'s tree.
export function rootOf(nodes: Map<string, Todo>, id: string): Todo | undefined {
  let n = nodes.get(id);
  while (n && n.parentID != null) n = nodes.get(n.parentID);
  return n;
}

// Every id in the subtree rooted at rootID, the node itself included.
export function subtreeIDs(nodes: Map<string, Todo>, rootID: string): string[] {
  const kids = childMap(nodes);
  const out: string[] = [];
  const stack = [rootID];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of kids.get(id) || []) stack.push(c.id);
  }
  return out;
}

// Fractional position between two neighbors (numbers, or null for open ends).
// NOTE: float midpoint gives ~50 same-spot inserts before precision loss;
// acceptable at scratchpad scale. Revisit with renumber-on-collision later.
export function between(lo: number | null, hi: number | null): number {
  if (lo == null && hi == null) return 1;
  if (lo == null) return hi! - 1;
  if (hi == null) return lo + 1;
  return (lo + hi) / 2;
}

// ── Projection: tree → ordered lines with depth ──
// Two things never make it into the projection, and so never reach the page:
//
//   1. A fully-checked top-level tree. Finishing every box in a tree retires it.
//   2. A todo bucketed for a later day (see buckets.ts). `today` is the caller's
//      local calendar date as YYYY-MM-DD; a node whose hideUntil is strictly
//      after it is waiting, not hidden forever, and returns on its own morning.
//
// Both tests are applied at depth 0 only: a tree travels as a unit, so a child
// is never independently retired or bucketed away from its parent.
export function walk(nodes: Map<string, Todo>, today: string): Line[] {
  const kids = childMap(nodes);
  const lines: Line[] = [];
  (function dfs(parentID: string | null, depth: number) {
    for (const n of kids.get(parentID) || []) {
      if (depth === 0 && fullyChecked(nodes, n, kids)) continue;
      if (depth === 0 && isBucketed(n, today)) continue;
      lines.push({ node: n, depth });
      dfs(n.id, depth + 1);
    }
  })(null, 0);
  return lines;
}

// A node is bucketed when it carries a hideUntil the calendar has not reached.
// "someday" is the bucket with no date: it never arrives on its own, so it is
// always bucketed, and only ever comes back by hand.
export function isBucketed(node: Todo, today: string): boolean {
  if (!node.hideUntil) return false;
  if (node.hideUntil === SOMEDAY) return true;
  return node.hideUntil > today; // YYYY-MM-DD compares correctly as a string
}

// The hideUntil value of the dateless bucket. A sentinel rather than a date, so
// it can never arrive; `> today` would be false for any real date we could pick.
export const SOMEDAY = "someday";
