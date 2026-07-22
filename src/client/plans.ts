// Plans — the named containers a todo lives in, and the pages you edit them on.
//
// A plan is a stored record ({ id, name, order, archived }, see shared-types) with an
// editable name shown as the plan-page's <h1> and on its sidebar pill. A todo's tree
// belongs to exactly one plan, named by its ROOT's planID; a subtree travels with its
// root, so a child's planID is null and resolved by walking up (planOf). A plan is
// archived — dropped off the sidebar — once every todo in it is checked.
//
// "Today" is not a plan. It is a read-only, cross-plan lens: every unchecked todo whose
// date (its own, or one inherited from an ancestor) is the local calendar's today. A
// todo's date is DERIVED from its keyboardText by optparse — never stored (see optparse.ts).

import { rootOf } from "./tree.ts";
import { optparse } from "./optparse.ts";

// Today as the user's calendar sees it, YYYY-MM-DD. Local, deliberately: a todo dated
// "tomorrow" at 11pm means the user's tomorrow, not UTC's. Built from the local getters
// rather than toISOString(), which would convert to UTC first and hand back yesterday for
// anyone west of Greenwich after dinner.
export function todayLocal(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${day}`;
}

// A node's OWN date — the one its text carries, if any — as YYYY-MM-DD, or null. Derived
// from keyboardText by optparse and never stored. The `#` guard skips the parse for the
// common tag-less line.
export function ownDate(node: Todo): string | null {
  const kt = node.keyboardText || "";
  if (!kt.includes("#")) return null;
  return optparse(kt).getKey["date"] ?? null;
}

// A node's EFFECTIVE date: its own date if it has one, else the nearest dated ancestor's.
// A dated todo passes its date down to its descendants, which inherit it unless they carry
// a date of their own. Null when neither the node nor any ancestor is dated.
export function effectiveDate(
  nodes: Map<string, Todo>,
  node: Todo,
): string | null {
  let n: Todo | undefined = node;
  while (n) {
    const d = ownDate(n);
    if (d) return d;
    n = n.parentID != null ? nodes.get(n.parentID) : undefined;
  }
  return null;
}

// Which plan a todo's tree belongs to: its root's planID. Read through the root because a
// subtree cannot belong to a different plan than its own root.
export function planOf(nodes: Map<string, Todo>, node: Todo): string | null {
  return rootOf(nodes, node.id)?.planID ?? null;
}

// How many days a plan has been alive, counting inclusively from its birthday: created today
// reads as 1, tomorrow as 2. Both dates are local YYYY-MM-DD; the diff is taken in UTC-midnight
// terms purely to count calendar days without a DST hour sneaking in. Returns 0 — "don't show an
// age" — when the plan carries no createdAt (it predates the field) or the string is unparseable.
export function daysAlive(createdAt: string, today: string): number {
  if (!createdAt) return 0;
  const [y1, m1, d1] = createdAt.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const born = Date.UTC(y1, m1 - 1, d1);
  const now = Date.UTC(y2, m2 - 1, d2);
  const days = Math.floor((now - born) / 86_400_000);
  return days >= 0 ? days + 1 : 0;
}

// The plans to show in the sidebar: the un-archived ones, in `order`. Ties break on id so
// the order is total and stable (the same tie-break cmpNodes uses for positions).
export function livePlans(plans: Map<string, Plan>): Plan[] {
  return [...plans.values()]
    .filter((p) => !p.archived)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
