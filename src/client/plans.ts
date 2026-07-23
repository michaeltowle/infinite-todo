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

// A node's OWN date as YYYY-MM-DD, or null. A date tag still present in the text WINS: that is a
// date being typed or re-typed live, before it is sunk on blur (see Todo.date) — and legacy nodes
// that predate the stored field keep their date this way too. Once the tag is sunk away (or there
// never was one) the stored date is used. The `#` guard skips the parse for the common tag-less
// line, which is every sunk node. Because the live tag and the value it sinks to agree, today and
// the pill read the same before and after a sink — so a sink needs no re-render.
export function ownDate(node: Todo): string | null {
  const kt = node.keyboardText || "";
  if (kt.includes("#")) {
    const tagged = optparse(kt).getKey["date"];
    if (tagged) return tagged;
  }
  return node.date ?? null;
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

// A todo was checked off on the same local calendar day as `today` (a todayLocal() string).
// Powers the today-box/priority-box rule that a just-completed todo stays visible, crossed
// out, through the rest of the day it was finished — then rolls off at the next midnight,
// once completedAt's day no longer agrees with `today`.
export function completedToday(node: Todo, today: string): boolean {
  return node.completedAt != null && todayLocal(new Date(node.completedAt)) === today;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// A local clock time as "9:35pm": 12-hour, no leading zero on the hour, lower-case meridiem.
function clockTime(d: Date): string {
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return `${h}:${min}${ampm}`;
}

// When a plan was created, in words for its pill. createdAt is epoch ms; "" out for 0 (unknown).
// Today OR yesterday → just the time ("9:35pm"): recent enough that the clock time alone is the
// useful thing, and "yesterday" only added visual noise. Anything older → the calendar date
// ("Jul 3"). The comparison is by local calendar day, not a rolling 24 hours.
export function formatCreatedAt(createdAt: number, now: Date = new Date()): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  const bornDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((today.getTime() - bornDay.getTime()) / 86_400_000);
  if (dayDiff === 0 || dayDiff === 1) return clockTime(d);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

// The plans to show in the sidebar: the un-archived ones, in `order`. Ties break on id so
// the order is total and stable (the same tie-break cmpNodes uses for positions).
export function livePlans(plans: Map<string, Plan>): Plan[] {
  return [...plans.values()]
    .filter((p) => !p.archived)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
