// Buckets — the drop-targets in the #mono-sidebar's bucket-box.
//
// A bucket is a day you are not thinking about yet. Drop a todo on one and it
// leaves #todo-container, taking its subtree with it, and comes back by itself on
// the morning it is due. Nothing is archived and nothing is deleted: the node is
// untouched apart from its `hideUntil`, and walk() simply declines to project it
// until the calendar catches up.
//
// The whole feature is one field. That is deliberate — "capture everything into a
// trusted system" is worth very little if the system is elaborate enough to
// distrust.

import { SOMEDAY } from "./tree.ts";

export interface Bucket {
  id: string; // the DOM id of its .bucket element
  label: string; // what the bucket calls itself on screen
  hideUntil: string; // what a todo dropped here gets: YYYY-MM-DD, or SOMEDAY
}

// How many dated buckets to show. Six reaches from tomorrow to a week out, which
// is as far ahead as any of this is worth planning by hand.
const DATED_BUCKETS = 6;

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

// The buckets as of `now`: tomorrow, the five days after it, then Someday. The
// labels are relative, so they are recomputed rather than stored — Wednesday's
// bucket is a different date next week, and a bucket the calendar has passed
// should never linger in the sidebar.
export function bucketsFor(now: Date = new Date()): Bucket[] {
  const buckets: Bucket[] = [];
  for (let offset = 1; offset <= DATED_BUCKETS; offset++) {
    const date = addDays(now, offset);
    buckets.push({
      id: "bucket-" + ymd(date),
      label: offset === 1 ? "Tomorrow" : WEEKDAYS[date.getDay()],
      hideUntil: ymd(date),
    });
  }
  buckets.push({
    id: "bucket-someday",
    label: "Someday",
    hideUntil: SOMEDAY,
  });
  return buckets;
}
