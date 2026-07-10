// x.michaeltowle.io — the scratchpad Worker.
//
// Only /scratchpad and its API resolve; every other path is a real 404 (no
// catch-all shell). API requests are forwarded to the one TodoTree Durable
// Object, which owns all state. GET /scratchpad serves the editor page — the
// client (clientMain, below) is serialized into the page via toString().

export { TodoTree } from './tree.js';

// Imported as text (see the Text rule in wrangler.toml) and inlined into the
// page head as a data-URI favicon — no extra route, so routing stays 404-only.
import iconSvg from './scratchpad-pencil-icon.svg';

// Build-time values (deploy time; or latest src edit + last commit for dev),
// written by scripts/generate-build-timestamp.mjs. Rendered into #deploy-stamp.
import { buildStamp } from './deploy-stamp.js';

// Personality quotes ({ quoteText, quoteAuthor } POJOs). Bundled at build time
// and inlined into the page as QUOTES; used to seed a fresh todo when the
// scratchpad empties out.
import quotes from '../personality/quotes.json';

const API_PATHS = new Set(['/scratchpad/tree', '/scratchpad/mutations']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (API_PATHS.has(pathname)) {
      return treeStub(env).fetch(request);
    }
    if (pathname === '/scratchpad') {
      return page();
    }
    return new Response('not found', { status: 404 });
  },
};

// The single global TodoTree instance. One user, one document → one DO.
function treeStub(env) {
  return env.TREE.get(env.TREE.idFromName('root'));
}

function page() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(iconSvg)}">
<title>Scratchpad</title>
<style>
:root{--page-w:1200px}
html,body{margin:0;padding:0;background:#f1ebdf;scrollbar-width:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}
.scroll{min-height:100vh;width:100%;display:flex;justify-content:center;background:#f1ebdf}
/* The two .double-sidebar flankers stay pure gutters — they size and center
   #todo-container and hold no content. #mono-sidebar carries both
   pill-containers at every width, so the pills keep a single home in the DOM. */
.sidebar{flex:1 1 0;min-width:0}
@media (max-width:1279px){.double-sidebar{display:none}}
#todo-container{width:var(--page-w);max-width:100%;background:#faf5ea;border-left:1px solid rgba(120,90,40,.11);border-right:1px solid rgba(120,90,40,.11);padding:92px 120px 320px;box-sizing:border-box}
@media (max-width:1400px){:root{--page-w:900px}}
@media (max-width:600px){#todo-container{padding:32px 16px 320px}}
.todo-row{display:flex;align-items:flex-start;gap:12px;padding:3px 0}
.todo-checkbox{flex:none;width:18px;height:18px;border-radius:4px;border:1.5px solid #cbb894;background:transparent;margin-top:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#fff;font-size:12px;line-height:1}
.todo-checkbox.checked{border-color:#9c7a3c;background:#9c7a3c}
.todo-row input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#43392a;padding:0}
.todo-row[data-checked="1"] input{text-decoration:line-through;opacity:.5}
input::placeholder{color:#bcad90}
/* Pinned over the left gutter while the flankers show; a bottom bar once they
   drop out; hidden on phones. position:fixed lifts it out of the flex row, so
   the flankers still center #todo-container. */
#mono-sidebar{position:fixed;z-index:10;left:5px;top:5px;bottom:5px;width:calc((100vw - var(--page-w)) / 2 - 10px);display:flex;flex-direction:column;justify-content:space-between;gap:6px}
@media (max-width:1279px){#mono-sidebar{left:5px;right:5px;top:auto;bottom:5px;width:auto;flex-direction:row;flex-wrap:wrap;align-items:flex-end;justify-content:center}}
@media (max-width:600px){#mono-sidebar{display:none}}
.pill-container{box-sizing:border-box;padding:12px;background:#faf5ea;border:1px solid rgba(120,90,40,.11);border-radius:8px;display:flex;flex-direction:column;gap:6px;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:#333}
@media (max-width:1279px){.pill-container{flex-direction:row;flex-wrap:wrap;align-items:center}}
.pill{display:flex;flex-wrap:wrap;gap:5px;align-items:baseline;background:transparent;border-radius:3px;padding:4px 7px}
.action-pill{border:none;margin:0;font:inherit;text-align:left;cursor:pointer;color:inherit;transition:background .12s}
.action-pill:hover{background:#f1e7d3}
.pill-text-primary{color:#333;white-space:nowrap}
.pill-text-secondary{color:#b07a30;white-space:nowrap}
</style>
</head>
<body>
<div class="scroll" id="scroll">
<div class="sidebar double-sidebar" id="left-sidebar"></div>
<div id="todo-container"></div>
<div class="sidebar double-sidebar" id="right-sidebar"></div>
<div class="sidebar mono-sidebar" id="mono-sidebar">
<div class="pill-container action-box">
<button class="pill action-pill" type="button" id="copy-as-json-raw-array"><span class="pill-text-primary">copy as json</span> <span class="pill-text-secondary">raw array</span></button>
<button class="pill action-pill" type="button" id="copy-as-json-nested-object-tree"><span class="pill-text-primary">copy as json</span> <span class="pill-text-secondary">nested object tree</span></button>
</div>
<div class="pill-container info-box">
<div class="pill info-pill" id="deployed-timestamp"><span class="pill-text-primary">deployed</span> <span class="pill-text-secondary"></span></div>
<div class="pill info-pill" id="page-edit-timestamp"><span class="pill-text-primary">page edit</span> <span class="pill-text-secondary"></span></div>
<div class="pill info-pill" id="commit-timestamp"><span class="pill-text-primary">commit</span> <span class="pill-text-secondary"></span></div>
<div class="pill info-pill" id="on-branch-branchname"><span class="pill-text-primary">on branch</span> <span class="pill-text-secondary"></span></div>
</div>
</div>
</div>
<script>
// clientMain is serialized from the Worker bundle via toString(); wrangler's
// esbuild wraps named functions with a keepNames __name() helper that lives in
// module scope and isn't carried into the page. Shim it (no-op) so the
// serialized body resolves it here.
var __name = function (x) { return x; };
var BUILD_STAMP = ${JSON.stringify(buildStamp)};
var QUOTES = ${JSON.stringify(quotes)};
;(${clientMain.toString()})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// ── Browser client ──────────────────────────────────────────────────────────
// Defined here as a normal function purely so it can be serialized into the
// page with toString(). It must be self-contained (no closure over module
// scope). Layers are kept separate: a data/tree mirror, a walk() projection,
// an isolated cursor module, and a command layer that translates keystrokes
// into tree mutations. optparse is a stub (see optparse(), below).
function clientMain() {
  const INDENT = 28;
  const FONT = "16px -apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
  const DEBOUNCE_MS = 400;

  const list = document.getElementById('todo-container');
  const scroll = document.getElementById('scroll');

  // ── Data layer: client mirror of the DO ──
  let nodesById = new Map();
  let treeRevision = 0;
  let currentLines = []; // last walk() result (document order)
  let pending = null; // cursor target after a re-render: { id, col }
  const editTimers = new Map(); // id → debounce handle for typing

  function loadTree() {
    return fetch('/scratchpad/tree')
      .then((r) => r.json())
      .then((data) => {
        treeRevision = data.treeRevision || 0;
        nodesById = new Map();
        for (const n of data.nodes) nodesById.set(n.id, n);
      })
      .catch(() => {});
  }

  function postMutations(batch) {
    fetch('/scratchpad/mutations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.treeRevision === 'number')
          treeRevision = d.treeRevision;
      })
      .catch(() => {});
  }

  // Apply a mutation to the local mirror exactly as the DO does, then persist.
  function commit(batch) {
    for (const m of batch) applyLocal(m);
    postMutations(batch);
  }
  function applyLocal(m) {
    const key = m.id;
    if (m.op === 'insert') {
      nodesById.set(key, {
        id: m.id,
        parentID: m.parentID != null ? m.parentID : null,
        position: m.position,
        checkbox: m.checkbox || false,
        keyboardText: m.keyboardText || '',
      });
    } else if (m.op === 'replace' || m.op === 'move') {
      const cur = nodesById.get(key);
      if (!cur) return;
      const next = Object.assign({}, cur);
      for (const f of ['checkbox', 'keyboardText', 'parentID', 'position']) {
        if (f in m) next[f] = m[f];
      }
      nodesById.set(key, next);
    } else if (m.op === 'delete') {
      deleteLocalSubtree(m.id);
    }
  }
  function deleteLocalSubtree(rootID) {
    const kids = childMap();
    const stack = [rootID];
    while (stack.length) {
      const id = stack.pop();
      nodesById.delete(id);
      for (const c of kids.get(id) || []) stack.push(c.id);
    }
  }

  // ── Tree helpers ──
  function childMap() {
    const kids = new Map();
    for (const n of nodesById.values()) {
      const p = n.parentID != null ? n.parentID : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    for (const arr of kids.values()) arr.sort(cmpNodes);
    return kids;
  }
  function cmpNodes(a, b) {
    return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  // The primitive: every node whose parent is parentID, in sibling order.
  function childrenOf(parentID) {
    const p = parentID != null ? parentID : null;
    return [...nodesById.values()]
      .filter((n) => (n.parentID != null ? n.parentID : null) === p)
      .sort(cmpNodes);
  }
  // A node's own row (its parent's children — includes the node itself).
  function siblingsOf(node) {
    return childrenOf(node.parentID);
  }
  // True when `node` and every descendant is checked — the whole subtree is
  // done. `kids` is an optional childMap() (parentID → sorted children); pass
  // one to reuse it across calls. Used to hide completed top-level trees in
  // walk(), but kept general for future callers.
  function fullyChecked(node, kids) {
    kids = kids || childMap();
    if (!node.checkbox) return false;
    for (const c of kids.get(node.id) || []) {
      if (!fullyChecked(c, kids)) return false;
    }
    return true;
  }
  // Walk parent pointers up to the 0-depth node that roots `id`'s tree.
  function rootOf(id) {
    let n = nodesById.get(id);
    while (n && n.parentID != null) n = nodesById.get(n.parentID);
    return n;
  }
  // Fractional position between two neighbors (numbers or null for open ends).
  // NOTE: float midpoint gives ~50 same-spot inserts before precision loss;
  // acceptable at scratchpad scale. Revisit with renumber-on-collision later.
  function between(lo, hi) {
    if (lo == null && hi == null) return 1;
    if (lo == null) return hi - 1;
    if (hi == null) return lo + 1;
    return (lo + hi) / 2;
  }

  // ── Projection: tree → ordered lines with depth (the mock's `lines`) ──
  function walk() {
    const kids = childMap();
    const lines = [];
    (function dfs(parentID, depth) {
      for (const n of kids.get(parentID) || []) {
        // A todo-tree is a single 0-depth node; hide the whole tree once every
        // box in it is checked (see fullyChecked).
        if (depth === 0 && fullyChecked(n, kids)) continue;
        lines.push({ node: n, depth });
        dfs(n.id, depth + 1);
      }
    })(null, 0);
    return lines;
  }

  // ── Render ──
  function render() {
    currentLines = walk();
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const line of currentLines) {
      const n = line.node;
      const row = document.createElement('div');
      row.className = 'todo-row';
      row.dataset.checked = n.checkbox ? '1' : '0';
      row.style.marginLeft = line.depth * INDENT + 'px';

      const btn = document.createElement('button');
      btn.className = n.checkbox ? 'todo-checkbox checked' : 'todo-checkbox';
      btn.dataset.id = n.id;
      btn.textContent = n.checkbox ? '✓' : '';

      const input = document.createElement('input');
      input.dataset.id = n.id;
      input.value = n.keyboardText || '';
      input.placeholder = 'To-do';

      row.appendChild(btn);
      row.appendChild(input);
      frag.appendChild(row);
    }
    list.appendChild(frag);
    applyPending();
  }

  // ── Cursor module (isolated): focus + caret only. Never touches data. ──
  function applyPending() {
    if (!pending) return;
    focusLine(pending.id, pending.col);
    pending = null;
  }
  function focusLine(id, col) {
    const el = list.querySelector('input[data-id="' + id + '"]');
    if (!el) return;
    el.focus();
    const c = col == null ? el.value.length : col;
    try {
      el.setSelectionRange(c, c);
    } catch (_) {}
  }
  function measureCtx() {
    const c =
      measureCtx._c || (measureCtx._c = document.createElement('canvas'));
    const ctx = c.getContext('2d');
    ctx.font = FONT;
    return ctx;
  }
  // Preserve the caret's visual x-position when moving between lines of
  // differing indent (canvas text metrics). Ported from the mock.
  function moveCaret(from, to, col) {
    const ctx = measureCtx();
    const fromText = nodesById.get(from.node.id).keyboardText || '';
    const toText = nodesById.get(to.node.id).keyboardText || '';
    const srcW = ctx.measureText(fromText.slice(0, col)).width;
    const targetW = srcW + (from.depth - to.depth) * INDENT;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i <= toText.length; i++) {
      const d = Math.abs(ctx.measureText(toText.slice(0, i)).width - targetW);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    focusLine(to.node.id, best);
  }
  function blankFocus(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    const inputs = list.querySelectorAll('input[data-id]');
    const last = inputs[inputs.length - 1];
    if (last) {
      e.preventDefault();
      last.focus();
      last.setSelectionRange(last.value.length, last.value.length);
    }
  }

  // ── optparse (STUB) ──
  // Real optparse (type detection from input + opts + 2nd-order effects) lands
  // later. For now every line is a todo-line-item and this hook does nothing.
  function optparse(text) {
    return { type: 'todo-line-item' };
  }

  // ── Command layer: keystroke → tree mutation(s) + cursor target ──
  function lineOf(id) {
    return currentLines.find((l) => l.node.id === id);
  }

  function onInput(node, input) {
    const val = input.value;
    const cur = nodesById.get(node.id);
    if (cur)
      nodesById.set(node.id, Object.assign({}, cur, { keyboardText: val }));
    clearTimeout(editTimers.get(node.id));
    editTimers.set(
      node.id,
      setTimeout(() => {
        const n = nodesById.get(node.id);
        if (n)
          postMutations([
            { op: 'replace', id: node.id, keyboardText: n.keyboardText },
          ]);
        editTimers.delete(node.id);
      }, DEBOUNCE_MS),
    );
    optparse(val); // stubbed
  }

  function onToggle(btn) {
    const id = btn.dataset.id;
    const n = nodesById.get(id);
    if (!n) return;
    const val = !n.checkbox;
    commit([{ op: 'replace', id: id, checkbox: val }]);
    // Checking the last open box completes the whole top-level tree, which then
    // drops out of the view (see walk()) — re-render so it disappears. Any other
    // toggle updates the one checkbox in place, leaving the caret untouched.
    const root = rootOf(id);
    if (val && root && fullyChecked(root)) {
      seedIfEmpty(); // if that was the last visible tree, drop in a fresh quote
      render();
      return;
    }
    btn.className = val ? 'todo-checkbox checked' : 'todo-checkbox';
    btn.textContent = val ? '✓' : '';
    const row = btn.closest('.todo-row');
    if (row) row.dataset.checked = val ? '1' : '0';
  }

  function onEnter(line, input) {
    const node = line.node;
    const col = input.selectionStart;
    const nid = crypto.randomUUID();
    if (col === 0 && input.value !== '') {
      // Caret at start of a non-empty line: new empty line ABOVE (prev sibling).
      const sibs = siblingsOf(node);
      const idx = sibs.findIndex((s) => s.id === node.id);
      const lo = idx > 0 ? sibs[idx - 1].position : null;
      commit([
        {
          op: 'insert',
          id: nid,
          parentID: node.parentID != null ? node.parentID : null,
          position: between(lo, node.position),
          checkbox: false,
          keyboardText: '',
        },
      ]);
      pending = { id: node.id, col: 0 }; // caret stays on current line
    } else {
      // New empty line BELOW: first child if the node has children, else next sibling.
      const kids = childrenOf(node.id);
      if (kids.length) {
        commit([
          {
            op: 'insert',
            id: nid,
            parentID: node.id,
            position: between(null, kids[0].position),
            checkbox: false,
            keyboardText: '',
          },
        ]);
      } else {
        const sibs = siblingsOf(node);
        const idx = sibs.findIndex((s) => s.id === node.id);
        const hi = idx + 1 < sibs.length ? sibs[idx + 1].position : null;
        commit([
          {
            op: 'insert',
            id: nid,
            parentID: node.parentID != null ? node.parentID : null,
            position: between(node.position, hi),
            checkbox: false,
            keyboardText: '',
          },
        ]);
      }
      pending = { id: nid, col: 0 };
    }
    render();
  }

  function onBackspaceEmpty(line, input) {
    if (input.value !== '') return false;
    if (nodesById.size <= 1) return false;
    const i = currentLines.findIndex((l) => l.node.id === line.node.id);
    if (i <= 0) return false; // don't delete the first line
    if (childrenOf(line.node.id).length) return false; // don't delete a parent
    const prev = currentLines[i - 1];
    commit([{ op: 'delete', id: line.node.id }]);
    const prevText = nodesById.get(prev.node.id).keyboardText || '';
    pending = { id: prev.node.id, col: prevText.length };
    render();
    return true;
  }

  // The topmost visible line has nothing above to merge into, so onBackspaceEmpty
  // leaves it alone. When it's empty and childless, delete it instead and drop
  // the caret onto the line that rises to take its place. Kept separate so Delete
  // reaches only this case, never the merge-up path. No-op on the sole line.
  function onDeleteTopmostEmpty(line, input) {
    if (input.value !== '') return false;
    const i = currentLines.findIndex((l) => l.node.id === line.node.id);
    if (i !== 0) return false; // only the topmost line
    if (currentLines.length <= 1) return false; // keep at least one line
    if (childrenOf(line.node.id).length) return false; // don't delete a parent
    const next = currentLines[1];
    commit([{ op: 'delete', id: line.node.id }]);
    pending = { id: next.node.id, col: 0 };
    render();
    return true;
  }

  function onIndent(line, col) {
    const node = line.node;
    const sibs = siblingsOf(node);
    const idx = sibs.findIndex((s) => s.id === node.id);
    if (idx <= 0) return; // no previous sibling → nothing to indent under
    const newParent = sibs[idx - 1];
    const kids = childrenOf(newParent.id);
    const lastPos = kids.length ? kids[kids.length - 1].position : null;
    commit([
      {
        op: 'move',
        id: node.id,
        parentID: newParent.id,
        position: between(lastPos, null),
      },
    ]);
    pending = { id: node.id, col: col };
    render();
  }

  function onOutdent(line, col) {
    const node = line.node;
    if (node.parentID == null) return; // already at root
    const parent = nodesById.get(node.parentID);
    const grandID = parent.parentID != null ? parent.parentID : null;
    const gsibs = siblingsOf(parent);
    const pidx = gsibs.findIndex((s) => s.id === parent.id);
    const hi = pidx + 1 < gsibs.length ? gsibs[pidx + 1].position : null;
    commit([
      {
        op: 'move',
        id: node.id,
        parentID: grandID,
        position: between(parent.position, hi),
      },
    ]);
    pending = { id: node.id, col: col };
    render();
  }

  function onArrow(dir, line, input) {
    const i = currentLines.findIndex((l) => l.node.id === line.node.id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= currentLines.length) {
      // No line in that direction: snap the caret to the far edge of this line
      // (ArrowDown off the last line → end; ArrowUp off the first → start).
      const col = dir === 'down' ? input.value.length : 0;
      input.setSelectionRange(col, col);
      return;
    }
    moveCaret(currentLines[i], currentLines[j], input.selectionStart);
  }

  // ── Event wiring (delegated, so re-renders don't re-attach) ──
  list.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.id && t.tagName === 'INPUT') {
      const line = lineOf(t.dataset.id);
      if (line) onInput(line.node, t);
    }
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t.dataset && t.dataset.id && t.tagName === 'INPUT')) return;
    const line = lineOf(t.dataset.id);
    if (!line) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter(line, t);
    } else if (e.key === 'Backspace' && t.value === '') {
      if (onBackspaceEmpty(line, t) || onDeleteTopmostEmpty(line, t))
        e.preventDefault();
    } else if (e.key === 'Delete' && t.value === '') {
      if (onDeleteTopmostEmpty(line, t)) e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onArrow('up', line, t);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onArrow('down', line, t);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) onOutdent(line, t.selectionStart);
      else onIndent(line, t.selectionStart);
    }
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('button[data-id]') : null;
    if (btn) onToggle(btn);
  });
  scroll.addEventListener('mousedown', blankFocus);

  // ── Dev helper: the action-box's two action-pills copy the on-page todos as
  // JSON. Both cover exactly the nodes visible on the page — completed trees
  // that dropped out (see walk()) are excluded. #copy-as-json-raw-array → the
  // flat nodes in document order; #copy-as-json-nested-object-tree → the same
  // nodes nested under their parents in sibling order.
  function rawNodes() {
    return walk().map((l) => l.node);
  }
  function nestedTree() {
    const kids = childMap();
    return (function build(parentID, depth) {
      return (kids.get(parentID) || [])
        .filter((n) => !(depth === 0 && fullyChecked(n, kids)))
        .map((n) => ({
          id: n.id,
          checkbox: n.checkbox,
          keyboardText: n.keyboardText,
          position: n.position,
          children: build(n.id, depth + 1),
        }));
    })(null, 0);
  }
  // ── Deploy stamp: the info-box ships all four info-pills in the page; this
  // fills each one's secondary text by id and drops the pills that don't apply.
  // Live keeps #deployed-timestamp, localhost keeps #page-edit-timestamp and
  // #commit-timestamp; #on-branch-branchname survives both. Decided client-side
  // by hostname (the dev-server proxy rewrites the server-side one). BUILD_STAMP
  // is inlined into the page. ──
  (function renderDeployStamp() {
    const s = BUILD_STAMP;
    // Format "2026-07-08" + "09:52:36" → "9:52am on Jul 8"
    function formatStampTime(date, time) {
      const [y, m, d] = date.split('-');
      const [h, min] = time.split(':');
      const hNum = parseInt(h, 10);
      const ampm = hNum < 12 ? 'am' : 'pm';
      const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const mName = months[parseInt(m, 10) - 1];
      const dNum = parseInt(d, 10);
      return h12 + ':' + min + ampm + ' on ' + mName + ' ' + dNum;
    }
    function fillPill(id, value) {
      const pill = document.getElementById(id);
      if (!pill) return;
      const slot = pill.querySelector('.pill-text-secondary');
      if (slot) slot.textContent = value;
    }
    function dropPill(id) {
      const pill = document.getElementById(id);
      if (pill) pill.remove();
    }
    fillPill('on-branch-branchname', '#' + s.branch);
    if (window.location.hostname === 'localhost') {
      fillPill('page-edit-timestamp', formatStampTime(s.pageEdit.date, s.pageEdit.time));
      fillPill('commit-timestamp', formatStampTime(s.commit.date, s.commit.time));
      dropPill('deployed-timestamp');
    } else {
      fillPill('deployed-timestamp', formatStampTime(s.deploy.date, s.deploy.time));
      dropPill('page-edit-timestamp');
      dropPill('commit-timestamp');
    }
  })();

  // Tab title mirrors the deploy stamp's hostname check: live is "Scratchpad",
  // localhost is tagged so the two tabs are distinguishable.
  document.title =
    window.location.hostname === 'localhost'
      ? 'Scratchpad — localhost'
      : 'Scratchpad';

  function copyAsJSON(data) {
    const text = JSON.stringify(data, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  }
  function onActionPill(id, build) {
    const pill = document.getElementById(id);
    if (pill) pill.addEventListener('click', () => copyAsJSON(build()));
  }
  onActionPill('copy-as-json-raw-array', rawNodes);
  onActionPill('copy-as-json-nested-object-tree', nestedTree);

  // ── Auto-seed: keep the scratchpad from becoming a dead end ──
  // Compose a todo line from a quote (currently a one-item list). Format
  // matches the approved sample: "<quoteText>" -- <quoteAuthor>.
  function quoteLine() {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    return q ? '"' + q.quoteText + '" -- ' + q.quoteAuthor : '';
  }
  // When nothing is visible (fresh scratchpad, or every tree checked off and
  // hidden), drop in a new todo seeded from a quote. Caller re-renders.
  function seedIfEmpty() {
    if (walk().length > 0) return;
    const roots = childrenOf(null);
    const lastPos = roots.length ? roots[roots.length - 1].position : null;
    commit([
      {
        op: 'insert',
        id: crypto.randomUUID(),
        parentID: null,
        position: between(lastPos, null),
        checkbox: false,
        keyboardText: quoteLine(),
      },
    ]);
  }

  // ── Boot ──
  loadTree().then(() => {
    seedIfEmpty();
    render();
    const inputs = list.querySelectorAll('input[data-id]');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });
}
