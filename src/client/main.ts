// ── Browser client ──────────────────────────────────────────────────────────
// Bundled for the browser by scripts/build-client.mts (esbuild, IIFE) and inlined
// into the page by the Worker. Unlike the old clientMain(), this is an ordinary
// module: it may import freely, and it typechecks against the DOM lib rather than
// @cloudflare/workers-types (hence its own project, tsconfig/client.json — the two
// global type sets collide on Response, fetch, WebSocket, …).
//
// Layers are kept separate: pure tree functions (tree.ts), the bucket definitions
// (buckets.ts), and here — a data/tree mirror, a render, an isolated cursor module,
// and a command layer that translates keystrokes into tree mutations.

import { lastDeploymentTimestamp } from "../last-deployment-timestamp.ts";
import {
  between,
  childrenOf,
  fullyChecked,
  project,
  rootOf,
  siblingsOf,
  subtreeIDs,
} from "./tree.ts";
import {
  bucketsFor,
  inBucket,
  todayLocal,
  type Bucket,
  type BucketKey,
} from "./buckets.ts";
import { optparse } from "./optparse.ts";

const INDENT = 28;
const FONT = "16px -apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
const DEBOUNCE_MS = 400;
const RETRY_MS = 500;
const RECONNECT_MS = 1000;

// This tab's identity, for the life of the page. Every write carries it, and the
// DO uses it to skip this tab when fanning that write out — we already applied it
// optimistically, and re-applying would cost us a render, and with it the caret.
// Per TAB, not per device: two tabs on one laptop are two strangers.
const tabID = crypto.randomUUID();
const MUTATIONS_URL = "/scratchpad/mutations?tab=" + tabID;

const list = document.getElementById("todo-container") as HTMLElement;
const scroll = document.getElementById("scroll") as HTMLElement;
const bucketBox = document.getElementById("bucket-box") as HTMLElement;

// ── Data layer: client mirror of the DO ──
let nodesById = new Map<string, Todo>();
let treeRevision = 0;
let currentLines: Line[] = []; // last viewLines() result (document order)
let pending: { id: string; col: number } | null = null; // cursor target after a re-render
const editTimers = new Map<string, ReturnType<typeof setTimeout>>(); // id → debounce handle

// The calendar day the page is currently projecting. Held rather than recomputed
// per call so that every projection in one render agrees on what "today" is, and so a
// tab left open overnight can notice the date turn over (see watchForMidnight).
let today = todayLocal();

function loadTree() {
  return fetch("/scratchpad/tree")
    .then((r) => r.json() as Promise<{ treeRevision: number; nodes: Todo[] }>)
    .then((data) => {
      treeRevision = data.treeRevision || 0;
      nodesById = new Map();
      for (const n of data.nodes) nodesById.set(n.id, n);
    })
    .catch(() => {});
}

// ── Outbox: every write leaves through here, in order, and is never dropped ──
// One request in flight at a time, FIFO, retried until it lands. Ordering is not a
// nicety: an `edit` that overtakes the `create` of its own node arrives at a DO
// that has never heard of that node, hits `if (!existing) return`, and is thrown
// away. And a failed POST used to vanish just as quietly.
const outbox: Mutation[][] = [];
let draining = false;

function postMutations(batch: Mutation[]) {
  outbox.push(batch);
  drainOutbox();
}

async function drainOutbox() {
  if (draining) return;
  draining = true;
  while (outbox.length) {
    try {
      const r = await fetch(MUTATIONS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outbox[0]),
      });
      if (!r.ok) throw new Error("mutations POST: " + r.status);
      const d = (await r.json()) as { treeRevision?: number };
      if (typeof d.treeRevision === "number") treeRevision = d.treeRevision;
      outbox.shift(); // only now is the batch safe to forget
    } catch (_) {
      await new Promise((done) => setTimeout(done, RETRY_MS));
    }
  }
  draining = false;
}

// Apply a mutation to the local mirror exactly as the DO does, then persist.
// Anything still parked on a debounce timer is flushed into the same batch first,
// so a command can never race ahead of the text that was typed before it.
function commitLocal(batch: Mutation[]) {
  const all = flushEdits().concat(batch);
  for (const m of all) applyLocal(m);
  postMutations(all);
}

// Typing parks its text in a setTimeout (see onInput). Anything that must not lose
// it — issuing a command, leaving the page — drains those timers through here and
// gets the mutations they were going to send.
function flushEdits(): Mutation[] {
  const batch: Mutation[] = [];
  for (const [id, timer] of editTimers) {
    clearTimeout(timer);
    const n = nodesById.get(id);
    if (n) batch.push({ op: "edit", id: id, keyboardText: n.keyboardText });
  }
  editTimers.clear();
  return batch;
}

// The last chance to save. A page can go away between a keystroke and the debounce
// firing, and a fetch() started during unload is not guaranteed to outlive the page
// — sendBeacon is, which is the entire reason it exists. Re-sending a mutation the
// DO already applied is harmless.
function flushOnExit() {
  const unsent = ([] as Mutation[]).concat(...outbox).concat(flushEdits());
  if (!unsent.length) return;
  navigator.sendBeacon(
    MUTATIONS_URL,
    new Blob([JSON.stringify(unsent)], { type: "application/json" }),
  );
}
// Both, deliberately: pagehide is the reliable desktop signal, and visibilitychange
// is the one mobile Safari actually fires when the user switches away for good.
window.addEventListener("pagehide", flushOnExit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushOnExit();
});

function applyLocal(m: Mutation) {
  if (m.op === "create") {
    nodesById.set(m.id, {
      id: m.id,
      parentID: m.parentID,
      position: m.position,
      checked: m.checked,
      keyboardText: m.keyboardText,
      hideUntil: m.hideUntil,
    });
  } else if (m.op === "edit") {
    const cur = nodesById.get(m.id);
    if (!cur) return;
    const next = { ...cur };
    // The mutable fields, patched one by one: a mutation overwrites exactly the
    // fields it carries (the DO's MUTABLE_FIELDS loop, unrolled so the compiler
    // can check each assignment).
    if (m.checked !== undefined) next.checked = m.checked;
    if (m.keyboardText !== undefined) next.keyboardText = m.keyboardText;
    if (m.parentID !== undefined) next.parentID = m.parentID;
    if (m.position !== undefined) next.position = m.position;
    if (m.hideUntil !== undefined) next.hideUntil = m.hideUntil;
    nodesById.set(m.id, next);
  } else if (m.op === "delete") {
    for (const id of subtreeIDs(nodesById, m.id)) nodesById.delete(id);
  }
}

// ── Render ──
function render() {
  currentLines = viewLines();
  list.textContent = "";
  const frag = document.createDocumentFragment();
  for (const line of currentLines) {
    const n = line.node;
    const row = document.createElement("div");
    row.className = "todo-row";
    row.dataset.checked = n.checked ? "1" : "0";
    row.style.marginLeft = line.depth * INDENT + "px";

    const btn = document.createElement("button");
    btn.className = n.checked ? "todo-checked checked" : "todo-checked";
    btn.dataset.id = n.id;
    btn.textContent = n.checked ? "✓" : "";
    // The checkbox doubles as the drag handle — grab a todo by its box and drop it
    // on a bucket. Deliberately NOT the row: a draggable ancestor breaks mouse text
    // selection inside the child <input> in Safari and Firefox, and the caret is the
    // thing this editor is built around. The button is not a text field, so it can
    // carry the drag with nothing at stake. Click and drag coexist natively — a
    // click event only fires when no drag happened.
    btn.draggable = true;

    // A textarea, not an <input>: a todo's text wraps onto as many lines as it needs
    // rather than scrolling out of sight. Enter is still intercepted to make a new todo
    // (see the keydown handler), so the text itself never carries a newline — the extra
    // rows are pure soft-wrap. rows=1 is the floor; autosize() grows it to fit.
    const input = document.createElement("textarea");
    input.dataset.id = n.id;
    input.rows = 1;
    input.value = n.keyboardText || "";
    input.placeholder = "Todo";

    row.appendChild(btn);
    row.appendChild(input);
    frag.appendChild(row);
  }
  list.appendChild(frag);
  // Height is content-driven, so it can only be measured once the rows are in the DOM.
  for (const ta of list.querySelectorAll<HTMLTextAreaElement>("textarea[data-id]")) {
    autosize(ta);
  }
  renderBuckets();
  applyPending();
}

// Grow a todo's textarea to exactly fit its wrapped text — no inner scrollbar, no fixed
// row count. Reset to auto first so it can shrink as well as grow.
function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

// ── Buckets ──
// Rebuilt on every render, because both halves of a bucket are derived: its label
// is relative to today, and its count is a fact about the tree.
let buckets: Bucket[] = bucketsFor();

// The view the page is currently showing. Per-tab, never persisted or synced — a
// bucket is a lens, not a fact about the document, and two tabs may look through
// different ones. Tracked by key, not id, so it survives the sidebar being rebuilt
// (a midnight turnover, a re-render): "Tomorrow" is a different date next week but the
// same key. The landing view is Unbucketed — the capture inbox.
let activeKey: BucketKey = "unbucketed";

// The active bucket resolved against the current sidebar. Falls back to Unbucketed if
// the key ever names a bucket that no longer exists (it always does today).
function activeBucket(): Bucket {
  return buckets.find((b) => b.key === activeKey) ?? buckets[0];
}

// The lines of the active view: this bucket's trees, in document order, minus the
// fully-checked ones (finishing every box in a tree retires it from every view).
function viewLines(): Line[] {
  const b = activeBucket();
  return project(
    nodesById,
    (n, kids) => !fullyChecked(nodesById, n, kids) && inBucket(n, b, today),
  );
}

// Switch the active view. A no-op if you click the bucket you are already in.
function setActiveBucket(key: BucketKey) {
  if (key === activeKey) return;
  activeKey = key;
  seedActiveIfEmpty(); // an empty view is a dead end — nothing to type into
  render();
}

function renderBuckets() {
  const active = activeBucket();
  bucketBox.textContent = "";
  const frag = document.createDocumentFragment();
  for (const b of buckets) {
    const el = document.createElement("div");
    // The active bucket carries .bucket-active so the sidebar shows which view you are
    // in. Hairlines group the ladder into three: capture (Unbucketed, Today), the dated
    // days, and the dateless planning buckets — a rule under Today and over Big Ticket.
    let cls = "pill bucket";
    if (b.key === active.key) cls += " bucket-active";
    if (b.key === "today") cls += " bucket-rule-below";
    if (b.key === "big-ticket") cls += " bucket-rule-above";
    el.className = cls;
    el.id = b.id;
    el.dataset.key = b.key;
    // The drop target's hideUntil: a date, a sentinel, or empty for Unbucketed (which
    // hands a dropped todo a null hideUntil, tipping it back out of every dated view).
    el.dataset.hideUntil = b.hideUntil ?? "";

    const label = document.createElement("span");
    label.className = "pill-text-primary";
    label.textContent = b.label;

    // The secondary line is what makes the bucket a plan rather than a hole to drop
    // things into: how many trees are waiting in it, and how much of next Wednesday they
    // have already spent (see bucketSecondary — "3x (2:30)").
    const count = document.createElement("span");
    count.className = "pill-text-secondary";
    count.textContent = bucketSecondary(b);

    el.appendChild(label);
    el.appendChild(count);
    frag.appendChild(el);
  }
  bucketBox.appendChild(frag);
}

// How many todo-trees are waiting in a bucket. Top-level nodes only — a bucketed
// todo takes its subtree with it, and counting the descendants too would report a
// three-line tree as three separate things to do. A blank placeholder line (an empty
// view seeds one so it can be typed into) is not work, so it is not counted.
function countIn(b: Bucket): number {
  let n = 0;
  for (const node of childrenOf(nodesById, null)) {
    if (!inBucket(node, b, today)) continue;
    if (fullyChecked(nodesById, node)) continue;
    if (isBlankLeaf(node)) continue;
    n++;
  }
  return n;
}

// A lone empty line: no text, unchecked, no children. The blank a view seeds so it is
// not a dead end is one of these, and it should not inflate a bucket's count.
function isBlankLeaf(node: Todo): boolean {
  return (
    !node.checked &&
    !(node.keyboardText || "").trim() &&
    childrenOf(nodesById, node.id).length === 0
  );
}

// The bucket pill's amber secondary line: its unchecked-tree count as "Nx" (the "x" reads
// "times") and the cumulative time-est of its unchecked todos as "(h:mm)", each shown only
// when nonzero, e.g. "3x (2:30)". Both zero (an empty bucket) → the empty string, so no
// secondary text renders at all.
function bucketSecondary(b: Bucket): string {
  const n = countIn(b);
  const mins = cumulativeTimeEstUnchecked(b);
  let out = n ? n + "x" : "";
  if (mins > 0) out += (out ? " " : "") + "(" + formatTimeEst(mins) + ")";
  return out;
}

// The cumulative time-est, in minutes, of every unchecked todo whose tree lives in bucket
// b. Bucket membership is a root property, so we start from the roots that belong to b and
// walk each subtree; a checked node contributes nothing, so a fully-checked (retired) tree
// naturally sums to zero. Each node's time-est is re-derived from its keyboardText by
// optparse — nothing is stored. The keyboardText.includes("#") guard skips the parse for
// the common tag-less line.
function cumulativeTimeEstUnchecked(b: Bucket): number {
  let total = 0;
  for (const root of childrenOf(nodesById, null)) {
    if (!inBucket(root, b, today)) continue;
    for (const id of subtreeIDs(nodesById, root.id)) {
      const node = nodesById.get(id);
      if (!node || node.checked) continue;
      const kt = node.keyboardText || "";
      if (!kt.includes("#")) continue;
      const mins = optparse(kt).getKey["time-est"];
      if (mins) total += mins;
    }
  }
  return total;
}

// Integer minutes → "h:mm": hours un-padded, minutes always two digits. 150 → "2:30",
// 65 → "1:05", 45 → "0:45", 600 → "10:00". Per NOMENCLATURE (cumulativeTimeEstUnchecked):
// purely hh:mm, with no zero-padding of the hours.
function formatTimeEst(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + ":" + String(m).padStart(2, "0");
}

// Drop a todo into a bucket. The node keeps everything else — its text, its children,
// its place in the tree — and simply changes which view it belongs to (see inBucket()).
// Dropping onto Unbucketed passes a null hideUntil, which is how a todo comes back out
// of a dated bucket now that clicking navigates rather than empties.
function bucketTodo(id: string, hideUntil: string | null) {
  const node = nodesById.get(id);
  if (!node) return;
  commitLocal([{ op: "edit", id: id, hideUntil: hideUntil }]);
  seedActiveIfEmpty(); // moving the last visible tree out would otherwise leave a dead page
  render();
}

bucketBox.addEventListener("dragover", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".bucket");
  if (!el) return;
  e.preventDefault(); // the default is "reject the drop"; this is what permits it
  e.dataTransfer!.dropEffect = "move";
  el.classList.add("bucket-over");
});
bucketBox.addEventListener("dragleave", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".bucket");
  if (el) el.classList.remove("bucket-over");
});
bucketBox.addEventListener("drop", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".bucket");
  if (!el) return;
  e.preventDefault();
  el.classList.remove("bucket-over");
  const id = e.dataTransfer!.getData("text/plain");
  // Empty dataset.hideUntil is Unbucketed's null — a real destination, not a missing
  // one — so the drop is gated on the dragged id alone.
  if (id) bucketTodo(id, el.dataset.hideUntil || null);
});
// Click a bucket to look through it: it becomes the active view and #todo-container
// shows only its todos. This is the whole point of a bucket now — a lens you switch to,
// not a holding pen you tip back out (dropping onto Unbucketed does the tipping-out).
bucketBox.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".bucket");
  if (!el || !el.dataset.key) return;
  setActiveBucket(el.dataset.key as BucketKey);
});

// A tab left open across midnight is projecting yesterday: the buckets still say
// "Tomorrow" for a day that has arrived, and the todos due this morning are still
// hidden. Notice the turnover and re-project. A minute's granularity is plenty —
// nothing here is to the second — and the check is a string compare.
function watchForMidnight() {
  setInterval(() => {
    const now = todayLocal();
    if (now === today) return;
    today = now;
    buckets = bucketsFor();
    render();
  }, 60_000);
}

// ── Cursor module (isolated): focus + caret only. Never touches data. ──
function applyPending() {
  if (!pending) return;
  focusLine(pending.id, pending.col);
  pending = null;
}
function focusLine(id: string, col: number | null) {
  const el = list.querySelector<HTMLTextAreaElement>('textarea[data-id="' + id + '"]');
  if (!el) return;
  el.focus();
  const c = col == null ? el.value.length : col;
  try {
    el.setSelectionRange(c, c);
  } catch (_) {}
}
// The canvas is cached on the function object itself, so the measuring context is
// built once rather than per keystroke.
function measureCtx() {
  const cache = measureCtx as { _c?: HTMLCanvasElement };
  const c = cache._c || (cache._c = document.createElement("canvas"));
  const ctx = c.getContext("2d")!;
  ctx.font = FONT;
  return ctx;
}
// The caret's visual x-position: the line's indent plus the width of the text
// sitting to the left of the caret (canvas text metrics).
function caretX(line: Line, col: number) {
  const text = nodesById.get(line.node.id)?.keyboardText || "";
  return line.depth * INDENT + measureCtx().measureText(text.slice(0, col)).width;
}

// The x the caret is *trying* to hold while arrowing, in caretX() coordinates. Held
// across a run of consecutive vertical arrows, so a line too short to reach it
// clamps where the caret lands without narrowing the rest of the run. Any other
// cursor movement ends the run and clears this; null means "no run in progress".
let desiredX: number | null = null;

// Move the caret to `to`, at whichever column sits closest to the x being held.
function moveCaret(from: Line, to: Line, col: number) {
  const ctx = measureCtx();
  const targetX = desiredX ?? caretX(from, col);
  const toText = nodesById.get(to.node.id)?.keyboardText || "";
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i <= toText.length; i++) {
    const x = to.depth * INDENT + ctx.measureText(toText.slice(0, i)).width;
    const d = Math.abs(x - targetX);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  desiredX = targetX; // the run keeps aiming at the x it started with
  focusLine(to.node.id, best);
}
function blankFocus(e: MouseEvent) {
  const t = e.target as HTMLElement;
  desiredX = null; // a mousedown places the caret by hand, ending any arrow run
  if (t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
  if (t.closest("#mono-sidebar")) return; // the sidebar's own clicks are not the page's
  const inputs = list.querySelectorAll<HTMLTextAreaElement>("textarea[data-id]");
  const last = inputs[inputs.length - 1];
  if (last) {
    e.preventDefault();
    last.focus();
    last.setSelectionRange(last.value.length, last.value.length);
  }
}

// ── Live sync (read channel) ──
// The DO fans every applied batch out to the other open tabs, and this is where they
// land. Nothing is ever SENT over this socket: writes still go out as POSTs through
// the outbox, which knows how to retry them.
let socket: WebSocket | null = null;
let hasConnected = false;

function connectSocket() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(
    scheme + "//" + location.host + "/scratchpad/socket?tab=" + tabID,
  );
  socket.addEventListener("open", () => {
    // A *re*connect means we were deaf for a while, so the mirror cannot be trusted:
    // refetch the whole tree rather than trying to replay what we missed.
    if (hasConnected) refetch();
    hasConnected = true;
  });
  socket.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data as string) as {
      treeRevision?: number;
      batch?: Mutation[];
    };
    if (typeof msg.treeRevision === "number") treeRevision = msg.treeRevision;
    if (msg.batch) applyRemote(msg.batch);
  });
  socket.addEventListener("close", () => {
    socket = null;
    setTimeout(connectSocket, RECONNECT_MS);
  });
}

function refetch() {
  loadTree().then(() => {
    seedActiveIfEmpty();
    repositionCursorAfterRender();
  });
}

// A batch somebody else made. Apply it to the mirror exactly as the DO did, then
// re-render — holding the cursor, because render() rebuilds every row and would
// otherwise annihilate focus and caret mid-word.
//
// Note what is NOT here: seedActiveIfEmpty(). Seeding is a derived action — "nothing is
// visible, so drop in a blank line" — and if every device drew that conclusion
// independently, every device would seed.
function applyRemote(batch: Mutation[]) {
  for (const m of batch) {
    // Another device's text must never land in a line we have unsent text for — it
    // would overwrite the word under the user's fingers. A live debounce timer is
    // exactly that condition. Hold the text back and let the rest of the mutation
    // (checked, treePlacement, hideUntil) through.
    if (m.op === "edit" && m.keyboardText !== undefined && editTimers.has(m.id)) {
      const { keyboardText, ...withoutText } = m;
      applyLocal(withoutText);
      continue;
    }
    applyLocal(m);
  }
  repositionCursorAfterRender();
}

// render() destroys focus and caret by construction, so a re-render we did not ask
// for has to state where the cursor should end up first.
function repositionCursorAfterRender() {
  const el = document.activeElement as HTMLTextAreaElement | null;
  if (el && el.tagName === "TEXTAREA" && el.dataset.id) {
    pending = { id: el.dataset.id, col: el.selectionStart ?? 0 };
  }
  render();
}

// ── Command layer: keystroke → tree mutation(s) + cursor target ──
function lineOf(id: string) {
  return currentLines.find((l) => l.node.id === id);
}

function onInput(node: Todo, input: HTMLTextAreaElement) {
  autosize(input); // a keystroke may have added or removed a wrapped row
  const val = input.value;
  const cur = nodesById.get(node.id);
  if (cur) nodesById.set(node.id, { ...cur, keyboardText: val });
  clearTimeout(editTimers.get(node.id));
  editTimers.set(
    node.id,
    setTimeout(() => {
      const n = nodesById.get(node.id);
      if (n)
        postMutations([{ op: "edit", id: node.id, keyboardText: n.keyboardText }]);
      editTimers.delete(node.id);
    }, DEBOUNCE_MS),
  );
  // A '#'-tag may have just changed this bucket's cumulative time-est, so redraw the
  // bucket-box. It is a different subtree from #todo-container, so this never touches the
  // textarea the caret lives in — the no-re-render-on-type invariant is preserved.
  renderBuckets();
}

function onToggle(btn: HTMLButtonElement) {
  const id = btn.dataset.id;
  if (!id) return;
  const n = nodesById.get(id);
  if (!n) return;
  const val = !n.checked;
  commitLocal([{ op: "edit", id: id, checked: val }]);
  // Checking the last open box completes the whole top-level tree, which then drops
  // out of every view (see project()) — re-render so it disappears. Any other toggle
  // updates the one .todo-checked in place, leaving the caret untouched. Either way
  // the bucket counts may have moved, so they are redrawn.
  const root = rootOf(nodesById, id);
  if (val && root && fullyChecked(nodesById, root)) {
    seedActiveIfEmpty(); // if that was the last visible tree, drop in a blank line
    render();
    return;
  }
  btn.className = val ? "todo-checked checked" : "todo-checked";
  btn.textContent = val ? "✓" : "";
  const row = btn.closest<HTMLElement>(".todo-row");
  if (row) row.dataset.checked = val ? "1" : "0";
  renderBuckets();
}

// The hideUntil a newly-created node should carry. A new top-level node joins the view
// you are looking at, so it takes the active bucket's hideUntil — otherwise a line typed
// in the Friday view would vanish the instant it was created. A child's hideUntil is
// never read (bucket membership is a root property), so it stays null.
function hideUntilFor(parentID: string | null): string | null {
  return parentID == null ? activeBucket().hideUntil : null;
}

function onEnter(line: Line, input: HTMLTextAreaElement) {
  const node = line.node;
  const col = input.selectionStart ?? 0;
  const nid = crypto.randomUUID();
  if (col === 0 && input.value !== "") {
    // Caret at start of a non-empty line: new empty line ABOVE (prev sibling).
    const sibs = siblingsOf(nodesById, node);
    const idx = sibs.findIndex((s) => s.id === node.id);
    const lo = idx > 0 ? sibs[idx - 1].position : null;
    commitLocal([
      {
        op: "create",
        id: nid,
        parentID: node.parentID != null ? node.parentID : null,
        position: between(lo, node.position),
        checked: false,
        keyboardText: "",
        hideUntil: hideUntilFor(node.parentID),
      },
    ]);
    pending = { id: node.id, col: 0 }; // caret stays on current line
  } else {
    // New empty line BELOW: first child if the node has children, else next sibling.
    const kids = childrenOf(nodesById, node.id);
    if (kids.length) {
      commitLocal([
        {
          op: "create",
          id: nid,
          parentID: node.id,
          position: between(null, kids[0].position),
          checked: false,
          keyboardText: "",
          hideUntil: hideUntilFor(node.id),
        },
      ]);
    } else {
      const sibs = siblingsOf(nodesById, node);
      const idx = sibs.findIndex((s) => s.id === node.id);
      const hi = idx + 1 < sibs.length ? sibs[idx + 1].position : null;
      commitLocal([
        {
          op: "create",
          id: nid,
          parentID: node.parentID != null ? node.parentID : null,
          position: between(node.position, hi),
          checked: false,
          keyboardText: "",
          hideUntil: hideUntilFor(node.parentID),
        },
      ]);
    }
    pending = { id: nid, col: 0 };
  }
  render();
}

function onBackspaceEmpty(line: Line, input: HTMLTextAreaElement) {
  if (input.value !== "") return false;
  if (nodesById.size <= 1) return false;
  const i = currentLines.findIndex((l) => l.node.id === line.node.id);
  if (i <= 0) return false; // don't delete the first line
  if (childrenOf(nodesById, line.node.id).length) return false; // don't delete a parent
  const prev = currentLines[i - 1];
  commitLocal([{ op: "delete", id: line.node.id }]);
  const prevText = nodesById.get(prev.node.id)?.keyboardText || "";
  pending = { id: prev.node.id, col: prevText.length };
  render();
  return true;
}

// The topmost visible line has nothing above to merge into, so onBackspaceEmpty
// leaves it alone. When it's empty and childless, delete it instead and drop the
// caret onto the line that rises to take its place. No-op on the sole line.
function onDeleteTopmostEmpty(line: Line, input: HTMLTextAreaElement) {
  if (input.value !== "") return false;
  const i = currentLines.findIndex((l) => l.node.id === line.node.id);
  if (i !== 0) return false; // only the topmost line
  if (currentLines.length <= 1) return false; // keep at least one line
  if (childrenOf(nodesById, line.node.id).length) return false; // don't delete a parent
  const next = currentLines[1];
  commitLocal([{ op: "delete", id: line.node.id }]);
  pending = { id: next.node.id, col: 0 };
  render();
  return true;
}

function onIndent(line: Line, col: number) {
  const node = line.node;
  const sibs = siblingsOf(nodesById, node);
  const idx = sibs.findIndex((s) => s.id === node.id);
  if (idx <= 0) return; // no previous sibling → nothing to indent under
  const newParent = sibs[idx - 1];
  const kids = childrenOf(nodesById, newParent.id);
  const lastPos = kids.length ? kids[kids.length - 1].position : null;
  commitLocal([
    {
      op: "edit",
      id: node.id,
      parentID: newParent.id,
      position: between(lastPos, null),
    },
  ]);
  pending = { id: node.id, col: col };
  render();
}

function onOutdent(line: Line, col: number) {
  const node = line.node;
  if (node.parentID == null) return; // already at root
  const parent = nodesById.get(node.parentID);
  if (!parent) return;
  const grandID = parent.parentID != null ? parent.parentID : null;
  const gsibs = siblingsOf(nodesById, parent);
  const pidx = gsibs.findIndex((s) => s.id === parent.id);
  const hi = pidx + 1 < gsibs.length ? gsibs[pidx + 1].position : null;
  // Outdenting to the root level makes this node a tree of its own. It must join the
  // view you are looking at — otherwise a child outdented in the Friday view would land
  // in Unbucketed (a null hideUntil) and vanish from under the caret. Deeper outdents
  // (grandID is still a node) leave hideUntil alone; a non-root's is never read.
  const patch: EditMutation = {
    op: "edit",
    id: node.id,
    parentID: grandID,
    position: between(parent.position, hi),
  };
  if (grandID == null) patch.hideUntil = activeBucket().hideUntil;
  commitLocal([patch]);
  pending = { id: node.id, col: col };
  render();
}

function onArrow(dir: "up" | "down", line: Line, input: HTMLTextAreaElement) {
  const i = currentLines.findIndex((l) => l.node.id === line.node.id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= currentLines.length) {
    // No line in that direction: snap the caret to the far edge of this line.
    const col = dir === "down" ? input.value.length : 0;
    input.setSelectionRange(col, col);
    desiredX = caretX(line, col);
    return;
  }
  moveCaret(currentLines[i], currentLines[j], input.selectionStart ?? 0);
}

// ── Event wiring (delegated, so re-renders don't re-attach) ──
list.addEventListener("input", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (t.dataset && t.dataset.id && t.tagName === "TEXTAREA") {
    desiredX = null; // paste and IME move the caret without ever firing keydown
    const line = lineOf(t.dataset.id);
    if (line) onInput(line.node, t);
  }
});
list.addEventListener("keydown", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (!(t.dataset && t.dataset.id && t.tagName === "TEXTAREA")) return;
  const line = lineOf(t.dataset.id);
  if (!line) return;
  // Only a run of vertical arrows holds a desired x; every other key moves the caret
  // on its own terms and ends the run.
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") desiredX = null;
  if (e.key === "Enter") {
    e.preventDefault();
    onEnter(line, t);
  } else if (e.key === "Backspace" && t.value === "") {
    if (onBackspaceEmpty(line, t) || onDeleteTopmostEmpty(line, t)) e.preventDefault();
  } else if (e.key === "Delete" && t.value === "") {
    if (onDeleteTopmostEmpty(line, t)) e.preventDefault();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    onArrow("up", line, t);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    onArrow("down", line, t);
  } else if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) onOutdent(line, t.selectionStart ?? 0);
    else onIndent(line, t.selectionStart ?? 0);
  }
});
list.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest ? t.closest<HTMLButtonElement>("button[data-id]") : null;
  if (btn) onToggle(btn);
});
// The drag carries only the node id; the bucket does the rest. A subtree travels
// with its root, so there is nothing else to say.
list.addEventListener("dragstart", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (!btn || !btn.dataset.id) return;
  e.dataTransfer!.setData("text/plain", btn.dataset.id);
  e.dataTransfer!.effectAllowed = "move";
});
scroll.addEventListener("mousedown", blankFocus);

// ── Last deployment timestamp: fills the info-box's two pills, #deployed-timestamp
// and #on-branch-branchname, from the build-time stamp baked into the page.
(function renderLastDeploymentTimestamp() {
  const s = lastDeploymentTimestamp;
  // Format "2026-07-08" + "09:52:36" → "9:52am on Jul 8"
  function formatStampTime(date: string, time: string) {
    const [y, m, d] = date.split("-");
    const [h, min] = time.split(":");
    const hNum = parseInt(h, 10);
    const ampm = hNum < 12 ? "am" : "pm";
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const mName = months[parseInt(m, 10) - 1];
    const dNum = parseInt(d, 10);
    return h12 + ":" + min + ampm + " on " + mName + " " + dNum;
  }
  function fillPill(id: string, value: string) {
    const pill = document.getElementById(id);
    if (!pill) return;
    const slot = pill.querySelector(".pill-text-secondary");
    if (slot) slot.textContent = value;
  }
  fillPill("on-branch-branchname", "#" + s.branch);
  fillPill("deployed-timestamp", formatStampTime(s.deploy.date, s.deploy.time));
})();

document.title = "Scratchpad";

// ── Auto-seed: keep the active view from becoming a dead end ──
// With nothing visible in the current view (a fresh scratchpad, every tree in it checked
// off, its last tree bucketed elsewhere, or an empty bucket you just navigated to) no
// row renders, and since every keystroke handler is delegated off a textarea[data-id]
// target, there would be nothing to type into. So drop one blank todo into the active
// view. Caller re-renders.
function seedActiveIfEmpty() {
  if (viewLines().length > 0) return;
  const b = activeBucket();
  const roots = childrenOf(nodesById, null);
  const lastPos = roots.length ? roots[roots.length - 1].position : null;
  commitLocal([
    {
      op: "create",
      // Deliberately NOT a random id, unlike every other create. Seeding is a
      // *derived* action — "this view is empty, so drop in a blank line" — and two
      // tabs can reach that conclusion at the same moment. Random ids would give you
      // two blank lines. An id derived from the revision AND the view keeps two tabs on
      // the same empty view collapsing to one create, while two tabs on different empty
      // views each get their own blank.
      id: "blank-seed-" + treeRevision + "-" + b.key,
      parentID: null,
      position: between(lastPos, null),
      checked: false,
      keyboardText: "",
      // The blank belongs to the view it was seeded into, so it is there to type in.
      hideUntil: b.hideUntil,
    },
  ]);
}

// ── Boot ──
loadTree().then(() => {
  seedActiveIfEmpty();
  render();
  const inputs = list.querySelectorAll<HTMLTextAreaElement>("textarea[data-id]");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  connectSocket();
  watchForMidnight();
});
