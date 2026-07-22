// ── Browser client ──────────────────────────────────────────────────────────
// Bundled for the browser by scripts/build-client.mts (esbuild, IIFE) and inlined
// into the page by the Worker. Unlike the old clientMain(), this is an ordinary
// module: it may import freely, and it typechecks against the DOM lib rather than
// @cloudflare/workers-types (hence its own project, tsconfig/client.json — the two
// global type sets collide on Response, fetch, WebSocket, …).
//
// Layers are kept separate: pure tree functions (tree.ts), the plan model + date
// derivation (plans.ts), and here — a data/tree mirror, a render, an isolated cursor
// module, and a command layer that translates keystrokes into tree mutations.

import { lastDeploymentTimestamp } from "../../generated/last-deployment-timestamp.ts";
import {
  between,
  childMap,
  childrenOf,
  fullyChecked,
  project,
  siblingsOf,
  subtreeIDs,
} from "./tree.ts";
import {
  completedToday,
  effectiveDate,
  formatCreatedAt,
  livePlans,
  planOf,
  todayLocal,
} from "./plans.ts";
import { optparse } from "./optparse.ts";

const INDENT = 28;
const FONT = "16px -apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
const DEBOUNCE_MS = 400;
const RETRY_MS = 500;
const RECONNECT_MS = 1000;

// A coarse pointer is the "no mouse, no hardware keyboard" signal — a touch device with no
// Tab key. Those get the period-at-line-start outdent gesture (see the beforeinput handler).
// Deliberately NOT the CSS width breakpoint: a narrow desktop window trips that, but it still
// has a Tab key and wants a literal period. Read once — the pointer kind doesn't change mid-session.
const isMobile = window.matchMedia("(pointer: coarse)").matches;

// This tab's identity, for the life of the page. Every write carries it, and the
// DO uses it to skip this tab when fanning that write out — we already applied it
// optimistically, and re-applying would cost us a render, and with it the caret.
// Per TAB, not per device: two tabs on one laptop are two strangers.
const tabID = crypto.randomUUID();
const MUTATIONS_URL = "/scratchpad/mutations?tab=" + tabID;

const list = document.getElementById("todo-container") as HTMLElement;
const scroll = document.getElementById("scroll") as HTMLElement;
const planBox = document.getElementById("plan-box") as HTMLElement;
const priorityBox = document.getElementById("priority-box") as HTMLElement;
const todayBox = document.getElementById("today-box") as HTMLElement;
const planTitle = document.querySelector("#plan-page h1") as HTMLElement;

// ── Data layer: client mirror of the DO ──
let nodesById = new Map<string, Todo>();
let plansById = new Map<string, Plan>();
let treeRevision = 0;
let currentLines: Line[] = []; // last viewLines() result (document order)
let pending: { id: string; col: number } | null = null; // cursor target after a re-render
const editTimers = new Map<string, ReturnType<typeof setTimeout>>(); // id → debounce handle
let planNameTimer: ReturnType<typeof setTimeout> | null = null; // h1 rename debounce

// The calendar day the page is currently projecting. Held rather than recomputed
// per call so that every projection in one render agrees on what "today" is, and so a
// tab left open overnight can notice the date turn over (see watchForMidnight).
let today = todayLocal();

function loadTree() {
  return fetch("/scratchpad/tree")
    .then(
      (r) =>
        r.json() as Promise<{
          treeRevision: number;
          nodes: Todo[];
          plans: Plan[];
        }>,
    )
    .then((data) => {
      treeRevision = data.treeRevision || 0;
      nodesById = new Map();
      for (const n of data.nodes) nodesById.set(n.id, n);
      plansById = new Map();
      for (const p of data.plans || []) plansById.set(p.id, p);
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
      planID: m.planID,
      date: m.date,
      createdAt: m.createdAt,
      completedAt: m.completedAt,
      priority: m.priority,
    });
  } else if (m.op === "edit") {
    const cur = nodesById.get(m.id);
    if (!cur) return;
    const next = { ...cur };
    // The mutable fields, patched one by one: a mutation overwrites exactly the
    // fields it carries (the DO's MUTABLE_FIELDS loop, unrolled so the compiler
    // can check each assignment). createdAt is absent on purpose — it is set once at
    // birth and the DO ignores it on edit, so the mirror does too.
    if (m.checked !== undefined) next.checked = m.checked;
    if (m.keyboardText !== undefined) next.keyboardText = m.keyboardText;
    if (m.parentID !== undefined) next.parentID = m.parentID;
    if (m.position !== undefined) next.position = m.position;
    if (m.planID !== undefined) next.planID = m.planID;
    if (m.date !== undefined) next.date = m.date;
    if (m.completedAt !== undefined) next.completedAt = m.completedAt;
    if (m.priority !== undefined) next.priority = m.priority;
    nodesById.set(m.id, next);
  } else if (m.op === "delete") {
    for (const id of subtreeIDs(nodesById, m.id)) nodesById.delete(id);
  } else if (m.op === "create-plan") {
    plansById.set(m.id, {
      id: m.id,
      name: m.name,
      order: m.order,
      archived: m.archived,
      createdAt: m.createdAt,
    });
  } else if (m.op === "edit-plan") {
    const cur = plansById.get(m.id);
    if (!cur) return;
    const next = { ...cur };
    if (m.name !== undefined) next.name = m.name;
    if (m.order !== undefined) next.order = m.order;
    if (m.archived !== undefined) next.archived = m.archived;
    plansById.set(m.id, next);
  } else if (m.op === "delete-plan") {
    plansById.delete(m.id);
  }
}

// ── Render ──
// The visible text of a row at rest: its keyboardText with recognised tags stripped
// out (optparse). A row swaps back to the raw keyboardText the moment it is focused
// for editing, and back to this when it loses focus (see the focusin/focusout wiring).
// The '#' guard skips the parse for the common tag-less line.
function displayText(node: Todo): string {
  const kt = node.keyboardText || "";
  if (!kt.includes("#")) return kt;
  return optparse(kt).visibleDisplayText;
}

function render() {
  renderPlanTitle();
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
    // on a plan. Deliberately NOT the row: a draggable ancestor breaks mouse text
    // selection inside the child <input> in Safari and Firefox, and the caret is the
    // thing this editor is built around. The button is not a text field, so it can
    // carry the drag with nothing at stake. Click and drag coexist natively — a
    // click event only fires when no drag happened.
    btn.draggable = true;

    // A textarea, not an <input>: a todo's text wraps onto as many lines as it needs
    // rather than scrolling out of sight. Enter is still intercepted to make a new todo
    // (see the keydown handler), so the text itself never carries a newline — the extra
    // rows are pure soft-wrap. rows=1 is the floor; autosize() grows it to fit. At rest
    // it shows displayText (tags stripped); focusin swaps in the raw keyboardText.
    const input = document.createElement("textarea");
    input.dataset.id = n.id;
    input.rows = 1;
    input.value = displayText(n);
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
  renderPlans();
  renderPriority();
  renderToday();
  applyPending();
}

// Grow a todo's textarea to exactly fit its wrapped text — no inner scrollbar, no fixed
// row count. Reset to auto first so it can shrink as well as grow.
function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

// ── Plans ──
// The plan the page is currently showing. Per-tab, never persisted or synced — a plan-page
// is a lens, and two tabs may look through different ones. The landing view is the first
// live plan (see boot).
let activePlanID = "";

// The active plan resolved against the current set, falling back to the first live plan if
// the id ever names one that no longer exists (e.g. the active plan was just archived).
function activePlan(): Plan | null {
  return plansById.get(activePlanID) ?? livePlans(plansById)[0] ?? null;
}

// The lines of the active plan-page: every tree whose root belongs to this plan, in
// document order. Checked todos are NOT filtered out — they stay on the page, struck
// through, until the whole plan is checked off and archived.
function viewLines(): Line[] {
  const p = activePlan();
  if (!p) return [];
  return project(nodesById, (n) => (n.planID ?? null) === p.id);
}

// Switch the plan-page. A no-op if you click the plan you are already in.
function setActivePlan(id: string) {
  if (id === activePlanID) return;
  activePlanID = id;
  seedActiveIfEmpty(); // an empty plan is a dead end — nothing to type into
  render();
}

// The active plan's name in the editable <h1>. Skipped while the h1 itself has focus, so a
// re-render triggered by anything else cannot yank the text out from under the caret.
function renderPlanTitle() {
  if (document.activeElement === planTitle) return;
  planTitle.textContent = activePlan()?.name ?? "";
}

function renderPlans() {
  const active = activePlan();
  planBox.textContent = "";
  const frag = document.createDocumentFragment();
  for (const p of livePlans(plansById)) {
    const el = document.createElement("div");
    // The active plan carries .plan-active so the sidebar shows which page you are on.
    el.className = active && p.id === active.id ? "pill plan plan-active" : "pill plan";
    el.dataset.id = p.id;

    const label = document.createElement("span");
    label.className = "pill-text-primary";
    label.textContent = p.name || "Untitled";

    // Secondary text carries two facts, "·"-joined: how much of the plan is done as a fraction
    // "checked/total" ("2/5"), and when the plan was created ("9:35pm", "9:35pm yesterday", or
    // "Jul 3"). Either is dropped when it has nothing to say: no fraction on an empty plan (no
    // real todos), no creation stamp on a plan that predates createdAt. So a pill reads
    // "2/5 · Jul 3", "Jul 3", "2/5", or blank.
    const count = document.createElement("span");
    count.className = "pill-text-secondary";
    const { done, total } = planFraction(p);
    const created = formatCreatedAt(p.createdAt);
    const parts: string[] = [];
    if (total) parts.push(done + "/" + total);
    if (created) parts.push(created);
    count.textContent = parts.join(" · ");

    el.appendChild(label);
    el.appendChild(count);
    frag.appendChild(el);
  }
  // The one control in the plan-box: make a new plan and jump to it to name it.
  const add = document.createElement("div");
  add.className = "pill add-plan";
  add.textContent = "+ add plan";
  frag.appendChild(add);

  planBox.appendChild(frag);
}

// A plan's completed fraction: how many of its todos are checked (`done`) out of its real todos
// (`total`). Every non-blank node in the plan's trees is a todo — a line — and counts toward the
// total; the checked ones count toward done. A blank placeholder line (an empty plan seeds one so
// it can be typed into) is not work and is left out of both. The pill shows this as "done/total".
function planFraction(p: Plan): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const root of childrenOf(nodesById, null)) {
    if ((root.planID ?? null) !== p.id) continue;
    for (const id of subtreeIDs(nodesById, root.id)) {
      const node = nodesById.get(id);
      if (!node || isBlankLeaf(node)) continue;
      total++;
      if (node.checked) done++;
    }
  }
  return { done, total };
}

// A plan is complete — every one of its (non-blank) todos is checked — and so ready to be
// archived. An all-blank or empty plan is not complete: there is no work in it to finish.
function planComplete(p: Plan): boolean {
  let hasReal = false;
  for (const root of childrenOf(nodesById, null)) {
    if ((root.planID ?? null) !== p.id) continue;
    for (const id of subtreeIDs(nodesById, root.id)) {
      const node = nodesById.get(id);
      if (!node || isBlankLeaf(node)) continue;
      hasReal = true;
      if (!node.checked) return false;
    }
  }
  return hasReal;
}

// A lone empty line: no text, unchecked, no children. The blank a plan seeds so it is not a
// dead end is one of these, and it should not inflate a count or complete a plan.
function isBlankLeaf(node: Todo): boolean {
  return (
    !node.checked &&
    !(node.keyboardText || "").trim() &&
    childrenOf(nodesById, node.id).length === 0
  );
}

// ── Priority ──
// Todos ranked by dragging them onto the priority-box, across every plan (like Today) — as
// long as they still have something to say: unranked-nothing shows, but a ranked todo stays
// visible whether unchecked or checked off earlier TODAY (see completedToday), rolling off at
// midnight the same way Today does. Sorted by priority ascending — rank 1 first — ties (should
// they ever occur) broken on id, same tie-break cmpNodes uses for positions.
function priorityTodos(): Todo[] {
  return [...nodesById.values()]
    .filter((n) => n.priority != null && (!n.checked || completedToday(n, today)))
    .sort((a, b) => (a.priority! - b.priority!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function renderPriority() {
  priorityBox.textContent = "";
  const frag = document.createDocumentFragment();

  const head = document.createElement("div");
  head.className = "priority-head";
  head.textContent = "Priority";
  frag.appendChild(head);

  const todos = priorityTodos();
  if (!todos.length) {
    const empty = document.createElement("div");
    empty.className = "priority-empty";
    empty.textContent = "Nothing ranked";
    frag.appendChild(empty);
  } else {
    for (const n of todos) {
      const row = document.createElement("div");
      row.className = "priority-todo";
      row.dataset.id = n.id; // so a dragover/drop on the box can find the row it's over
      row.dataset.checked = n.checked ? "1" : "0";

      // A working checkbox, like today-box's (checking off a ranked todo shares the exact same
      // toggle — onToggleToday isn't Today-specific despite its name) — but ALSO a drag handle
      // here, unlike today-box's: a ranked row can be picked up to reorder or unrank it.
      const btn = document.createElement("button");
      btn.className = n.checked ? "todo-checked checked" : "todo-checked";
      btn.dataset.id = n.id;
      btn.textContent = n.checked ? "✓" : "";
      btn.draggable = true;

      const text = document.createElement("span");
      text.className = "priority-todo-text";
      text.textContent = displayText(n) || "Todo";

      row.appendChild(btn);
      row.appendChild(text);
      frag.appendChild(row);
    }
  }
  priorityBox.appendChild(frag);
}

// ── Drag onto the priority-box: rank, reorder, or unrank ──
// The id currently being dragged, from either the plan-page or the priority-box itself. Set on
// dragstart (see onDragStart, shared by both containers), cleared on dragend regardless of how
// the drag ended — dropped, cancelled, Escape. dataTransfer.getData() only reliably returns the
// dragged id inside the drop event itself (most browsers withhold it during dragover, for
// security), so the live dragover preview below reads this instead.
let draggingID: string | null = null;

function onDragStart(e: DragEvent) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (!btn || !btn.dataset.id) return;
  e.dataTransfer!.setData("text/plain", btn.dataset.id);
  e.dataTransfer!.effectAllowed = "move";
  draggingID = btn.dataset.id;
}
function onDragEnd() {
  draggingID = null;
  clearPriorityDragMarks();
}
function clearPriorityDragMarks() {
  for (const row of priorityBox.querySelectorAll<HTMLElement>(".priority-todo")) {
    row.classList.remove("priority-rule-above", "priority-rule-below", "priority-leaving");
  }
}

// Which ranked todo a drop under the pointer should land BEFORE — null past the last row,
// meaning "append at the end". `draggedID` is excluded from the reckoning (reordering a row
// already in the list must not let it block on its own current slot).
function priorityDropBeforeID(e: DragEvent, draggedID: string): string | null {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".priority-todo");
  if (!row || !row.dataset.id || row.dataset.id === draggedID) return null;
  const rect = row.getBoundingClientRect();
  const above = e.clientY < rect.top + rect.height / 2;
  if (above) return row.dataset.id;
  const ranked = priorityTodos().filter((n) => n.id !== draggedID);
  const idx = ranked.findIndex((n) => n.id === row.dataset.id);
  return ranked[idx + 1]?.id ?? null;
}

// The priority values straddling an insertion point ahead of `beforeID` (or the tail, past
// everyone, if null) — fed straight to the existing between() to mint the dropped todo's new
// rank. `draggedID` is excluded so reordering a ranked row doesn't count its own old slot twice.
function priorityNeighbors(draggedID: string, beforeID: string | null) {
  const ranked = priorityTodos().filter((n) => n.id !== draggedID);
  const idx = beforeID ? ranked.findIndex((n) => n.id === beforeID) : ranked.length;
  const hi = idx >= 0 && idx < ranked.length ? ranked[idx].priority : null;
  const lo = idx > 0 ? ranked[idx - 1].priority : null;
  return { lo: lo ?? null, hi: hi ?? null };
}

priorityBox.addEventListener("dragover", (e) => {
  e.preventDefault(); // the default is "reject the drop"; this is what permits it
  e.dataTransfer!.dropEffect = "move";
  clearPriorityDragMarks();
  const beforeID = priorityDropBeforeID(e, draggingID ?? "");
  if (beforeID) {
    priorityBox
      .querySelector<HTMLElement>(`.priority-todo[data-id="${beforeID}"]`)
      ?.classList.add("priority-rule-above");
  } else {
    const rows = priorityBox.querySelectorAll<HTMLElement>(".priority-todo");
    rows[rows.length - 1]?.classList.add("priority-rule-below");
  }
});
priorityBox.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation(); // outrank the page-wide "dropped outside the box" handler below
  const id = e.dataTransfer!.getData("text/plain");
  clearPriorityDragMarks();
  if (!id) return;
  const beforeID = priorityDropBeforeID(e, id);
  const { lo, hi } = priorityNeighbors(id, beforeID);
  commitLocal([{ op: "edit", id, priority: between(lo, hi) }]);
  render();
});

// Dropping a ranked todo anywhere OUTSIDE the priority-box clears its rank — dragging it back
// out unranks it, symmetric with dragging it in to rank it. Judged against the whole page, not
// just the plan-page, so dropping a ranked todo on a plan pill both moves its plan (planBox's
// own drop handler) and unranks it: still "outside the box". priorityBox's own drop above
// always stopPropagation()s, so a drop that landed inside it never reaches here.
scroll.addEventListener("dragover", (e) => {
  if (!draggingID) return;
  const n = nodesById.get(draggingID);
  if (!n || n.priority == null) return; // wasn't ranked — nothing to leave, nothing to preview
  e.preventDefault(); // permit a drop anywhere on the page while carrying a ranked todo
  const inside = priorityBox.contains(e.target as Node);
  if (!inside) clearPriorityDragMarks(); // no reorder line makes sense once you're outside the box
  const row = priorityBox.querySelector<HTMLElement>(`.priority-todo[data-id="${draggingID}"]`);
  if (row) row.classList.toggle("priority-leaving", !inside);
});
scroll.addEventListener("drop", (e) => {
  if (!draggingID) return;
  const n = nodesById.get(draggingID);
  if (!n || n.priority == null) return;
  commitLocal([{ op: "edit", id: draggingID, priority: null }]);
  render();
});

// ── Today ──
// Every todo whose effective date (its own, or one inherited from an ancestor) is today, in
// document order across every plan — as long as it still has something to say: either it is
// still unchecked, or it was checked off earlier TODAY and is keeping its place (crossed out)
// through the rest of the day it was finished. A todo checked off on some earlier day has
// already rolled over and is left out. This is the read-only right-panel view — you look at
// what is due, but you plan only on a plan-page.
function todayTodos(): Todo[] {
  const out: Todo[] = [];
  const kids = childMap(nodesById);
  (function dfs(parentID: string | null) {
    for (const n of kids.get(parentID) || []) {
      const due = !isBlankLeaf(n) && effectiveDate(nodesById, n) === today;
      if (due && (!n.checked || completedToday(n, today))) out.push(n);
      dfs(n.id);
    }
  })(null);
  return out;
}

function renderToday() {
  todayBox.textContent = "";
  const frag = document.createDocumentFragment();

  const head = document.createElement("div");
  head.className = "today-head";
  head.textContent = "Today";
  frag.appendChild(head);

  const todos = todayTodos();
  if (!todos.length) {
    const empty = document.createElement("div");
    empty.className = "today-empty";
    empty.textContent = "Nothing due";
    frag.appendChild(empty);
  } else {
    for (const n of todos) {
      const row = document.createElement("div");
      row.className = "today-todo";
      row.dataset.checked = n.checked ? "1" : "0";

      // A working checkbox, like a todo-row's — but not a drag handle here (today is a lens, not
      // a place you rearrange). Clicking it toggles the todo, same as a plan-page checkbox; a
      // just-checked one stays put (crossed out) until it rolls off at midnight (see
      // todayTodos), rather than leaving the box immediately.
      const btn = document.createElement("button");
      btn.className = n.checked ? "todo-checked checked" : "todo-checked";
      btn.dataset.id = n.id;
      btn.textContent = n.checked ? "✓" : "";

      const text = document.createElement("span");
      text.className = "today-todo-text";
      text.textContent = displayText(n) || "Todo";

      row.appendChild(btn);
      row.appendChild(text);
      frag.appendChild(row);
    }
  }
  todayBox.appendChild(frag);
}

// ── Plan mutations from the sidebar ──
// Make a new plan, jump to it, and drop the caret into its <h1> so it can be named
// straight away (Notion-style). It starts empty and seeds a blank todo so the page below
// the title is not a dead end.
function addPlan() {
  const id = crypto.randomUUID();
  const orders = livePlans(plansById).map((p) => p.order);
  const order = (orders.length ? Math.max(...orders) : 0) + 1;
  commitLocal([{ op: "create-plan", id, name: "", order, archived: false, createdAt: Date.now() }]);
  activePlanID = id;
  seedActiveIfEmpty();
  render();
  focusPlanTitle();
}

// Archive a plan — it "dies" and leaves the sidebar — then move the page to another live
// plan, making a fresh one if that was the last plan standing.
function archivePlan(id: string) {
  commitLocal([{ op: "edit-plan", id, archived: true }]);
  // Only move the page if the plan that just died is the one you were looking at. Checking a
  // plan's last todo off from the today-box archives a plan that may not be the active one —
  // that must not yank you off the page you are editing. (onToggle only ever archives the
  // active plan, so its behaviour is unchanged.)
  if (id === activePlanID) {
    const next = livePlans(plansById).find((p) => p.id !== id);
    if (next) {
      activePlanID = next.id;
    } else {
      ensureAPlan(); // no plans left — start a blank one
    }
  }
  seedActiveIfEmpty();
  render();
}

// Rename the active plan from its <h1>. Debounced like a todo edit, so a burst of typing is
// one write. The pill mirrors the name live; the h1 is the source of truth while focused.
function onPlanRename() {
  const p = activePlan();
  if (!p) return;
  const name = (planTitle.textContent || "").replace(/\n/g, " ").trim();
  plansById.set(p.id, { ...p, name });
  renderPlans();
  if (planNameTimer) clearTimeout(planNameTimer);
  planNameTimer = setTimeout(() => {
    postMutations([{ op: "edit-plan", id: p.id, name }]);
    planNameTimer = null;
  }, DEBOUNCE_MS);
}

function focusPlanTitle() {
  planTitle.focus();
  // Caret to the end of whatever is already there.
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(planTitle);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ── One-time migration off the old bucket model ──
// Todos created before plans existed carry a `hideUntil` and no `planID`, so in the plan
// world they belong to no plan and would be invisible. On the first load that finds nodes
// but no plans, sweep every ACTIVE (not fully-checked) tree into a plan called "Mike Todo";
// fully-checked trees — already retired and out of sight under the old model — are left with
// a null planID, so they stay gone. Guarded on "nodes exist, no plans", so it runs exactly
// once; the plan id is fixed so two tabs migrating at the same moment collapse to one plan.
// Safe to delete once it has run against the live scratchpad.
const MIKE_TODO = "mike-todo";
function migrateLegacyIfNeeded() {
  if (plansById.size > 0) return;
  const roots = childrenOf(nodesById, null);
  if (!roots.length) return;
  const batch: Mutation[] = [
    { op: "create-plan", id: MIKE_TODO, name: "Mike Todo", order: 1, archived: false, createdAt: Date.now() },
  ];
  for (const root of roots) {
    if (fullyChecked(nodesById, root)) continue; // leave retired trees out of any plan
    batch.push({ op: "edit", id: root.id, planID: MIKE_TODO });
  }
  commitLocal(batch);
}

// If no plan exists yet (a fresh scratchpad, or the last plan just archived), make one so
// there is always a page to land on.
function ensureAPlan() {
  if (livePlans(plansById).length) {
    activePlanID = activePlan()?.id ?? activePlanID;
    return;
  }
  const id = crypto.randomUUID();
  commitLocal([{ op: "create-plan", id, name: "", order: 1, archived: false, createdAt: Date.now() }]);
  activePlanID = id;
}

// ── Drag a todo onto a plan ──
// The deletes that clear a plan's leftover fake empty todo once real work lands in it.
// Visiting an empty plan persists a blank-seed line so the page is never a dead end (see
// seedActiveIfEmpty), but that line outlives the visit; drop a real todo into the same plan
// later and the blank is left sitting above it. Returns a delete for every root-level
// blank-seed still parked in `planID`'s plan — skipping `keepID` (the todo being dropped in)
// and any seed since typed into (isBlankLeaf excludes those).
function seededBlankDeletions(planID: string, keepID: string): Mutation[] {
  const out: Mutation[] = [];
  for (const node of childrenOf(nodesById, null)) {
    if (node.id === keepID) continue;
    if ((node.planID ?? null) !== planID) continue;
    if (!node.id.startsWith("blank-seed-")) continue;
    if (!isBlankLeaf(node)) continue;
    out.push({ op: "delete", id: node.id });
  }
  return out;
}

// Drop a todo into a plan. The node keeps everything else — its text, its children, its
// place in the tree — and simply changes which plan it belongs to. Real work arriving in
// the plan clears the fake empty todo it may have been seeded with, in the same batch.
function movePlan(id: string, planID: string) {
  const node = nodesById.get(id);
  if (!node) return;
  const sourcePlanID = planOf(nodesById, node);
  commitLocal([
    { op: "edit", id: id, planID: planID },
    ...seededBlankDeletions(planID, id),
  ]);
  // Moving out a plan's last unchecked todo leaves it fully checked, same as ticking the
  // last box does — so it archives the same way. Checked before seeding: a fresh blank
  // seed line doesn't count as real work (isBlankLeaf), so it can't hide a completion, but
  // there is no reason to drop one into a plan that is about to die anyway.
  if (sourcePlanID && sourcePlanID !== planID) {
    const source = plansById.get(sourcePlanID);
    if (source && !source.archived && planComplete(source)) {
      archivePlan(source.id); // handles seeding the new active page + render()
      return;
    }
  }
  seedActiveIfEmpty(); // moving the last visible tree out would otherwise leave a dead page
  render();
}

planBox.addEventListener("dragover", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".plan");
  if (!el) return;
  e.preventDefault(); // the default is "reject the drop"; this is what permits it
  e.dataTransfer!.dropEffect = "move";
  el.classList.add("plan-over");
});
planBox.addEventListener("dragleave", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".plan");
  if (el) el.classList.remove("plan-over");
});
planBox.addEventListener("drop", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".plan");
  if (!el || !el.dataset.id) return;
  e.preventDefault();
  el.classList.remove("plan-over");
  const id = e.dataTransfer!.getData("text/plain");
  if (id) movePlan(id, el.dataset.id);
});
// Click a plan to open its page; click "+ add plan" to make one.
planBox.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest(".add-plan")) {
    addPlan();
    return;
  }
  const el = t.closest<HTMLElement>(".plan");
  if (el && el.dataset.id) setActivePlan(el.dataset.id);
});

// ── Editable plan title (<h1>) ──
planTitle.addEventListener("input", onPlanRename);
// Enter commits the name and drops into the plan's first todo — the Notion flow of naming a
// plan then typing straight into it, rather than dropping a newline into the heading. focusLine
// blurs the h1 for us, and the name is already parked on its rename debounce so it lands either
// way. A plan always has at least one line (seedActiveIfEmpty), so currentLines[0] is there;
// blur is the belt-and-braces fallback if it somehow isn't.
planTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = currentLines[0];
    if (first) focusLine(first.node.id, 0);
    else planTitle.blur();
  }
});

// A tab left open across midnight is projecting yesterday: the today-box still shows
// yesterday's due todos. Notice the turnover and re-project. A minute's granularity is
// plenty — nothing here is to the second — and the check is a string compare.
function watchForMidnight() {
  setInterval(() => {
    const now = todayLocal();
    if (now === today) return;
    today = now;
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
  el.focus(); // focusin swaps in the raw keyboardText before we place the caret
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
// The caret's visual x-position: the line's indent plus the width of the text sitting to
// the left of the caret. A focused row shows the raw keyboardText, so the caret maths are
// against keyboardText.
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
  if (t.closest(".sidebar")) return; // a sidebar's own clicks are not the page's
  if (t.closest("#plan-page h1")) return; // nor the title's
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
    // refetch the whole tree rather than trying to replay what we missed. The FIRST open
    // deliberately does not refetch — loadTree() just ran, and a blind refetch here would
    // discard optimistic local edits typed before this socket finished connecting.
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
    migrateLegacyIfNeeded();
    ensureAPlan();
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
    // (checked, treePlacement, planID) through.
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
  const val = input.value; // a focused row holds the RAW keyboardText
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
  // A '#'-tag may have just changed this row's date or the plan's count, so redraw the
  // sidebars. They are separate subtrees from #todo-container, so this never touches the
  // textarea the caret lives in — the no-re-render-on-type invariant is preserved.
  renderPlans();
  renderToday();
}

function onToggle(btn: HTMLButtonElement) {
  const id = btn.dataset.id;
  if (!id) return;
  const n = nodesById.get(id);
  if (!n) return;
  const val = !n.checked;
  commitLocal([{ op: "edit", id: id, checked: val, completedAt: val ? Date.now() : null }]);
  // Checked todos stay on the page (struck through), so the row is updated in place rather
  // than removed. The sidebars change, though: the plan's count drops and a checked-today
  // todo leaves the today-box.
  btn.className = val ? "todo-checked checked" : "todo-checked";
  btn.textContent = val ? "✓" : "";
  const row = btn.closest<HTMLElement>(".todo-row");
  if (row) row.dataset.checked = val ? "1" : "0";
  renderPlans();
  renderToday();
  // Checking the last open box completes the plan — it dies and the page moves on.
  if (val) {
    const p = activePlan();
    if (p && planComplete(p)) archivePlan(p.id);
  }
}

// A checkbox in the today-box OR the priority-box toggles its todo, like a plan-page checkbox —
// shared by both despite the name, since the two lenses behave identically here. A just-checked
// one stays in its box (crossed out) rather than leaving right away; see todayTodos/priorityTodos.
// Checking (not unchecking) may complete the todo's plan, which may not be the one you're
// viewing, so completion is judged against ITS plan (planOf), and archivePlan only moves the
// page if that plan happened to be the active one. A full render() redraws everything — cheap,
// and neither box has a caret to protect.
function onToggleToday(id: string) {
  const n = nodesById.get(id);
  if (!n) return;
  const val = !n.checked;
  const planID = planOf(nodesById, n);
  commitLocal([{ op: "edit", id: id, checked: val, completedAt: val ? Date.now() : null }]);
  const p = planID ? plansById.get(planID) : null;
  if (val && p && planComplete(p)) archivePlan(p.id);
  else render();
}

// The planID a newly-created node should carry. A new top-level node joins the plan you are
// looking at, so it takes the active plan's id — otherwise a line typed here would belong to
// no plan and vanish. A child's planID is never read (membership is a root property), so it
// stays null.
function planIDFor(parentID: string | null): string | null {
  return parentID == null ? (activePlan()?.id ?? null) : null;
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
        planID: planIDFor(node.parentID),
        date: null,
        createdAt: Date.now(),
        completedAt: null,
        priority: null,
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
          planID: planIDFor(node.id),
          date: null,
          createdAt: Date.now(),
          completedAt: null,
          priority: null,
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
          planID: planIDFor(node.parentID),
          date: null,
          createdAt: Date.now(),
          completedAt: null,
          priority: null,
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

// An empty line has nothing to delete leftward into, so a caret already at 0 has
// nowhere native to go. If the line right above (in document order) carries text,
// ArrowLeft instead jumps the caret there, to its very end — as if the empty line
// were not in the way. A no-op when there is no previous line, or it is empty too.
function onArrowLeftEmpty(line: Line, input: HTMLTextAreaElement): boolean {
  if (input.value !== "") return false;
  if (input.selectionStart !== 0 || input.selectionEnd !== 0) return false;
  const i = currentLines.findIndex((l) => l.node.id === line.node.id);
  if (i <= 0) return false;
  const prev = currentLines[i - 1];
  const prevText = nodesById.get(prev.node.id)?.keyboardText || "";
  if (!prevText) return false;
  focusLine(prev.node.id, prevText.length);
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
  // Outdenting to the root level makes this node a tree of its own. It must join the plan
  // you are looking at — otherwise a child outdented here would land with a null planID and
  // vanish. Deeper outdents (grandID is still a node) leave planID alone; a non-root's is
  // never read.
  const patch: EditMutation = {
    op: "edit",
    id: node.id,
    parentID: grandID,
    position: between(parent.position, hi),
  };
  if (grandID == null) patch.planID = activePlan()?.id ?? null;
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
// A row at rest shows displayText (tags stripped); focusing it reveals the raw keyboardText
// to edit, and blurring hides the tags again. focusin/focusout bubble (focus/blur do not),
// so one delegated pair covers every row.
list.addEventListener("focusin", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (t.tagName !== "TEXTAREA" || !t.dataset.id) return;
  const n = nodesById.get(t.dataset.id);
  if (!n) return;
  const raw = n.keyboardText || "";
  if (t.value !== raw) {
    t.value = raw;
    autosize(t);
  }
});
list.addEventListener("focusout", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (t.tagName !== "TEXTAREA" || !t.dataset.id) return;
  const n = nodesById.get(t.dataset.id);
  if (!n) return;
  // Sink a #date tag on blur: pull the date into the stored field and strip the tag from the text
  // for good (see Todo.date), so it stops re-appearing — ugly, in the way — every time the line is
  // focused. Only when a real date tag is actually present (the parse changed the text). This is a
  // pure persist, deliberately WITHOUT any re-render: the sidebars can't change (the tag was
  // already display-stripped, and the date was already read via ownDate's fallback, so today and
  // the fraction show the same thing before and after), and re-rendering on blur would destroy the
  // element a click is landing on — e.g. blurring this row to click a today-box checkbox.
  const raw = n.keyboardText || "";
  const parsed = optparse(raw);
  if (parsed.getKey["date"] && parsed.visibleDisplayText !== raw) {
    commitLocal([
      { op: "edit", id: n.id, keyboardText: parsed.visibleDisplayText, date: parsed.getKey["date"] },
    ]);
  }
  // Show the at-rest text (tags stripped). After a sink the mirror already holds the clean text.
  const cur = nodesById.get(t.dataset.id);
  const vis = cur ? displayText(cur) : "";
  if (t.value !== vis) {
    t.value = vis;
    autosize(t);
  }
});
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
  } else if (e.key === "ArrowLeft") {
    if (onArrowLeftEmpty(line, t)) e.preventDefault();
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
// Mobile has no Tab key, so a period typed at the very start of a line outdents it — the touch
// equivalent of Shift+Tab. beforeinput, not keydown: soft keyboards fire unreliable keydowns for
// character keys (key:"Unidentified", keyCode 229), but beforeinput is cancelable, names the
// character in e.data, and the caret it reports is still the pre-insertion one. Only swallow the
// period when there is actually a parent to outdent from; at the root there is nothing to outdent
// into, so the '.' types normally — otherwise a line could never begin with one.
list.addEventListener("beforeinput", (e) => {
  if (!isMobile) return;
  const ie = e as InputEvent;
  if (ie.inputType !== "insertText" || ie.data !== ".") return;
  const t = e.target as HTMLTextAreaElement;
  if (!(t.dataset && t.dataset.id && t.tagName === "TEXTAREA")) return;
  if (t.selectionStart !== 0 || t.selectionEnd !== 0) return; // caret at line start, nothing selected
  const line = lineOf(t.dataset.id);
  if (!line || line.node.parentID == null) return; // already at root — let the period through
  e.preventDefault();
  onOutdent(line, 0);
});
list.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest ? t.closest<HTMLButtonElement>("button[data-id]") : null;
  if (btn) onToggle(btn);
});
// The drag carries only the node id; the plan (or the priority-box, or nothing) does the rest.
// A subtree travels with its root, so there is nothing else to say. Shared with priorityBox's
// own rows below — onDragStart also notes draggingID for the priority drag-affordance.
list.addEventListener("dragstart", onDragStart);
// A click on a today-box or priority-box checkbox toggles that todo, same as a plan-page one —
// onToggleToday isn't Today-specific despite its name. Only the checkbox is live in either box —
// the text is not editable here, keeping both read-only lenses for everything except "toggle it".
todayBox.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (btn && btn.dataset.id) onToggleToday(btn.dataset.id);
});
priorityBox.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (btn && btn.dataset.id) onToggleToday(btn.dataset.id);
});
priorityBox.addEventListener("dragstart", onDragStart);
document.addEventListener("dragend", onDragEnd);
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

// ── Auto-seed: keep the active plan-page from becoming a dead end ──
// With nothing visible in the current plan (a fresh plan, every tree in it just moved out)
// no row renders, and since every keystroke handler is delegated off a textarea[data-id]
// target, there would be nothing to type into. So drop one blank todo into the active plan.
// Caller re-renders.
function seedActiveIfEmpty() {
  if (viewLines().length > 0) return;
  const p = activePlan();
  if (!p) return;
  const roots = childrenOf(nodesById, null);
  const lastPos = roots.length ? roots[roots.length - 1].position : null;
  commitLocal([
    {
      op: "create",
      // Deliberately NOT a random id, unlike every other create. Seeding is a *derived*
      // action — "this plan is empty, so drop in a blank line" — and two tabs can reach
      // that conclusion at the same moment. Random ids would give two blank lines. An id
      // derived from the revision AND the plan keeps two tabs on the same empty plan
      // collapsing to one create.
      id: "blank-seed-" + treeRevision + "-" + p.id,
      parentID: null,
      position: between(lastPos, null),
      checked: false,
      keyboardText: "",
      planID: p.id,
      date: null,
      createdAt: Date.now(),
      completedAt: null,
      priority: null,
    },
  ]);
}

// ── Boot ──
loadTree().then(() => {
  migrateLegacyIfNeeded(); // one-time: sweep pre-plans todos into "Mike Todo"
  ensureAPlan(); // a fresh scratchpad has no plans — start one
  activePlanID = activePlan()?.id ?? activePlanID;
  seedActiveIfEmpty();
  render();
  const inputs = list.querySelectorAll<HTMLTextAreaElement>("textarea[data-id]");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  connectSocket();
  watchForMidnight();
});
