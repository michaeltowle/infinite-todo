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
// A projection is the tree flattened into document order with each node's depth. What
// reaches the page is decided one node at a time, and only at depth 0: `keepRoot` is
// asked of every top-level node, and a tree travels as a unit, so a child is never
// independently retired, bucketed, or filtered away from its parent.
//
// The predicate is the caller's — the renderer builds one from the active bucket (show
// this bucket's trees, minus the fully-checked ones). Keeping the rule out here is what
// lets tree.ts stay ignorant of buckets and views.
export function project(
  nodes: Map<string, Todo>,
  keepRoot: (node: Todo, kids: Map<string | null, Todo[]>) => boolean,
): Line[] {
  const kids = childMap(nodes);
  const lines: Line[] = [];
  (function dfs(parentID: string | null, depth: number) {
    for (const n of kids.get(parentID) || []) {
      if (depth === 0 && !keepRoot(n, kids)) continue;
      lines.push({ node: n, depth });
      dfs(n.id, depth + 1);
    }
  })(null, 0);
  return lines;
}
