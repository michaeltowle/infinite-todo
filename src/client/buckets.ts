// Buckets — the drop-targets AND the views in the #mono-sidebar's bucket-box.
//
// A bucket is a slice of the tree you look at on its own. Click one and it becomes
// the active view: #todo-container shows only that bucket's todos, and nothing else.
// Drop a todo on a bucket and its subtree moves into that slice. Everything is one
// field, the node's `hideUntil`:
//
//   Unbucketed  hideUntil === null       — the capture inbox, and the landing view
//   Today       a real date <= today     — due today, plus anything overdue that has
//                                           arrived (a bucketed day the calendar reached)
//   Tomorrow…   a real date === that day — the next six calendar days, one bucket each
//   Big Ticket  hideUntil === BIG_TICKET  — a dateless holding bucket (see below)
//   Someday     hideUntil === SOMEDAY     — the other dateless bucket; never arrives
//
// The membership test is applied at depth 0 only: a subtree travels with its root, so
// only a root's hideUntil decides which bucket its whole tree lives in (see project()).
//
// Big Ticket is where planning trees will eventually live. For now it behaves exactly
// like the other dateless buckets; later its pill will list each tree's top node with
// days-to-due and percent-complete. That is deliberately unbuilt — due dates do not
// exist yet.

import { SOMEDAY } from "./tree.ts";

// A stable handle for a bucket that does not shift as the calendar turns over. The
// active view is tracked by key, not by id or label: "Tomorrow" is a different date
// next week, but the same key.
export type BucketKey =
  | "unbucketed"
  | "today"
  | `day-${number}`
  | "big-ticket"
  | "someday";

export interface Bucket {
  key: BucketKey; // stable across days; what the active view is tracked by
  id: string; // the DOM id of its .bucket element
  label: string; // what the bucket calls itself on screen
  hideUntil: string | null; // what a todo dropped here gets: null, a date, or a sentinel
}

// The dateless bucket for planning trees. A sentinel, like SOMEDAY: never a real
// date, so a node carrying it is never "arrived".
export const BIG_TICKET = "big-ticket";

// How many calendar days after today get their own bucket. Six reaches a week out,
// which with Today at the head is a rolling seven-day window.
const FUTURE_DAYS = 6;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Today as the user's calendar sees it, YYYY-MM-DD. Local, deliberately: a todo
// bucketed "tomorrow" at 11pm means the user's tomorrow, not UTC's. Built from
// the local getters rather than toISOString(), which would convert to UTC first
// and hand back yesterday for anyone west of Greenwich after dinner.
export function todayLocal(now: Date = new Date()): string {
  return ymd(now);
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// `n` days after `from`, as a local calendar date. Date's own month/day rollover
// does the work, DST included — adding 1 to the 31st gives the 1st.
function addDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// The buckets as of `now`, in sidebar order: Unbucketed, Today, the next six days,
// then the two dateless buckets. The dated labels are relative, so they are recomputed
// rather than stored — Wednesday's bucket is a different date next week.
export function bucketsFor(now: Date = new Date()): Bucket[] {
  const buckets: Bucket[] = [
    { key: "unbucketed", id: "bucket-unbucketed", label: "Unbucketed", hideUntil: null },
    { key: "today", id: "bucket-today", label: "Today", hideUntil: ymd(now) },
  ];
  for (let offset = 1; offset <= FUTURE_DAYS; offset++) {
    const date = addDays(now, offset);
    buckets.push({
      key: `day-${offset}`,
      id: "bucket-" + ymd(date),
      label: offset === 1 ? "Tomorrow" : WEEKDAYS[date.getDay()],
      hideUntil: ymd(date),
    });
  }
  buckets.push({
    key: "big-ticket",
    id: "bucket-big-ticket",
    label: "Big Ticket",
    hideUntil: BIG_TICKET,
  });
  buckets.push({
    key: "someday",
    id: "bucket-someday",
    label: "Someday",
    hideUntil: SOMEDAY,
  });
  return buckets;
}

// Does `node`'s tree belong in `bucket`'s view? `today` is the caller's local date.
// Read at depth 0 only (see project()): only a root's hideUntil is consulted, because
// a subtree cannot be bucketed away from its own root.
//
//   Unbucketed  — never bucketed at all.
//   Today       — any real date the calendar has reached, so overdue todos surface
//                 here rather than staying hidden. This is the only "<=" test; every
//                 future day matches its date exactly, so nothing is double-counted.
//   otherwise   — an exact match on the bucket's hideUntil (a future day, or a sentinel).
export function inBucket(node: Todo, bucket: Bucket, today: string): boolean {
  const hu = node.hideUntil ?? null;
  if (bucket.key === "unbucketed") return hu === null;
  if (bucket.key === "today") return isRealDate(hu) && hu <= today;
  return hu === bucket.hideUntil;
}

// A real calendar date, as opposed to a sentinel (SOMEDAY / BIG_TICKET) or null.
function isRealDate(hu: string | null): hu is string {
  return hu !== null && hu !== SOMEDAY && hu !== BIG_TICKET;
}
