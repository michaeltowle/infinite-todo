// ── Browser client ──────────────────────────────────────────────────────────
// This is browser code, not Worker code: it is never called here, only
// serialized into the page with clientMain.toString() (see page() in the Worker
// entry). Two consequences, both load-bearing:
//
//   1. clientMain MUST stay self-contained — no closure over module scope, no
//      runtime imports. Only the function's own body crosses into the page, so
//      anything it referenced from outside would be undefined there. Type-only
//      references are fine: they're erased before the bundle exists.
//   2. It typechecks against the DOM lib, not @cloudflare/workers-types. That is
//      why it sits in its own project (tsconfig.client.json) — the two global
//      type sets collide (both declare Response, fetch, WebSocket, …).
//
// LAST_DEPLOYMENT_TIMESTAMP and QUOTES are inlined into the page as globals by
// page(), so they are declared here rather than imported (a runtime import would
// not survive toString()).
//
// Layers are kept separate: a data/tree mirror, a walk() projection, an isolated
// cursor module, and a command layer that translates keystrokes into tree
// mutations. optparse is a stub (see optparse(), below).

declare const LAST_DEPLOYMENT_TIMESTAMP: DeploymentStamp;
declare const QUOTES: { quoteText: string; quoteAuthor: string }[];

export function clientMain() {
  const INDENT = 28;
  const FONT = "16px -apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
  const DEBOUNCE_MS = 400;

  const list = document.getElementById('todo-container') as HTMLElement;
  const scroll = document.getElementById('scroll') as HTMLElement;

  // ── Data layer: client mirror of the DO ──
  let nodesById = new Map<string, Todo>();
  let treeRevision = 0;
  let currentLines: Line[] = []; // last walk() result (document order)
  let pending: { id: string; col: number } | null = null; // cursor target after a re-render
  const editTimers = new Map<string, ReturnType<typeof setTimeout>>(); // id → debounce handle

  function loadTree() {
    return fetch('/scratchpad/tree')
      .then((r) => r.json() as Promise<{ treeRevision: number; nodes: Todo[] }>)
      .then((data) => {
        treeRevision = data.treeRevision || 0;
        nodesById = new Map();
        for (const n of data.nodes) nodesById.set(n.id, n);
      })
      .catch(() => {});
  }

  function postMutations(batch: Mutation[]) {
    fetch('/scratchpad/mutations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
      .then((r) => r.json() as Promise<{ treeRevision?: number }>)
      .then((d) => {
        if (d && typeof d.treeRevision === 'number')
          treeRevision = d.treeRevision;
      })
      .catch(() => {});
  }

  // Apply a mutation to the local mirror exactly as the DO does, then persist.
  function commit(batch: Mutation[]) {
    for (const m of batch) applyLocal(m);
    postMutations(batch);
  }
  function applyLocal(m: Mutation) {
    if (m.op === 'insert') {
      nodesById.set(m.id, {
        id: m.id,
        parentID: m.parentID,
        position: m.position,
        checked: m.checked,
        keyboardText: m.keyboardText,
      });
    } else if (m.op === 'replace' || m.op === 'move') {
      const cur = nodesById.get(m.id);
      if (!cur) return;
      const next = { ...cur };
      // The mutable fields, patched one by one: a mutation overwrites exactly
      // the fields it carries (the DO's MUTABLE_FIELDS loop, unrolled so the
      // compiler can check each assignment).
      if (m.checked !== undefined) next.checked = m.checked;
      if (m.keyboardText !== undefined) next.keyboardText = m.keyboardText;
      if (m.parentID !== undefined) next.parentID = m.parentID;
      if (m.position !== undefined) next.position = m.position;
      nodesById.set(m.id, next);
    } else if (m.op === 'delete') {
      deleteLocalSubtree(m.id);
    }
  }
  function deleteLocalSubtree(rootID: string) {
    const kids = childMap();
    const stack = [rootID];
    while (stack.length) {
      const id = stack.pop()!;
      nodesById.delete(id);
      for (const c of kids.get(id) || []) stack.push(c.id);
    }
  }

  // ── Tree helpers ──
  function childMap() {
    const kids = new Map<string | null, Todo[]>();
    for (const n of nodesById.values()) {
      const p = n.parentID != null ? n.parentID : null;
      const siblings = kids.get(p);
      if (siblings) siblings.push(n);
      else kids.set(p, [n]);
    }
    for (const arr of kids.values()) arr.sort(cmpNodes);
    return kids;
  }
  function cmpNodes(a: Todo, b: Todo) {
    return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  // The primitive: every node whose parent is parentID, in sibling order.
  function childrenOf(parentID: string | null) {
    const p = parentID != null ? parentID : null;
    return [...nodesById.values()]
      .filter((n) => (n.parentID != null ? n.parentID : null) === p)
      .sort(cmpNodes);
  }
  // A node's own row (its parent's children — includes the node itself).
  function siblingsOf(node: Todo) {
    return childrenOf(node.parentID);
  }
  // True when `node` and every descendant is checked — the whole subtree is
  // done. `kids` is an optional childMap() (parentID → sorted children); pass
  // one to reuse it across calls. Used to hide completed top-level trees in
  // walk(), but kept general for future callers.
  function fullyChecked(
    node: Todo,
    kids?: Map<string | null, Todo[]>,
  ): boolean {
    kids = kids || childMap();
    if (!node.checked) return false;
    for (const c of kids.get(node.id) || []) {
      if (!fullyChecked(c, kids)) return false;
    }
    return true;
  }
  // Walk parent pointers up to the 0-depth node that roots `id`'s tree.
  function rootOf(id: string) {
    let n = nodesById.get(id);
    while (n && n.parentID != null) n = nodesById.get(n.parentID);
    return n;
  }
  // Fractional position between two neighbors (numbers or null for open ends).
  // NOTE: float midpoint gives ~50 same-spot inserts before precision loss;
  // acceptable at scratchpad scale. Revisit with renumber-on-collision later.
  function between(lo: number | null, hi: number | null) {
    if (lo == null && hi == null) return 1;
    if (lo == null) return hi! - 1;
    if (hi == null) return lo + 1;
    return (lo + hi) / 2;
  }

  // ── Projection: tree → ordered lines with depth (the mock's `lines`) ──
  function walk() {
    const kids = childMap();
    const lines: Line[] = [];
    (function dfs(parentID: string | null, depth: number) {
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
      row.dataset.checked = n.checked ? '1' : '0';
      row.style.marginLeft = line.depth * INDENT + 'px';

      const btn = document.createElement('button');
      btn.className = n.checked ? 'todo-checked checked' : 'todo-checked';
      btn.dataset.id = n.id;
      btn.textContent = n.checked ? '✓' : '';

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
  function focusLine(id: string, col: number | null) {
    const el = list.querySelector<HTMLInputElement>(
      'input[data-id="' + id + '"]',
    );
    if (!el) return;
    el.focus();
    const c = col == null ? el.value.length : col;
    try {
      el.setSelectionRange(c, c);
    } catch (_) {}
  }
  // The canvas is cached on the function object itself, so the measuring context
  // is built once rather than per keystroke.
  function measureCtx() {
    const cache = measureCtx as { _c?: HTMLCanvasElement };
    const c = cache._c || (cache._c = document.createElement('canvas'));
    const ctx = c.getContext('2d')!;
    ctx.font = FONT;
    return ctx;
  }
  // Preserve the caret's visual x-position when moving between lines of
  // differing indent (canvas text metrics). Ported from the mock.
  function moveCaret(from: Line, to: Line, col: number) {
    const ctx = measureCtx();
    const fromText = nodesById.get(from.node.id)?.keyboardText || '';
    const toText = nodesById.get(to.node.id)?.keyboardText || '';
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
  function blankFocus(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'BUTTON') return;
    const inputs = list.querySelectorAll<HTMLInputElement>('input[data-id]');
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
  function optparse(text: string) {
    return { type: 'todo-line-item' };
  }

  // ── Command layer: keystroke → tree mutation(s) + cursor target ──
  function lineOf(id: string) {
    return currentLines.find((l) => l.node.id === id);
  }

  function onInput(node: Todo, input: HTMLInputElement) {
    const val = input.value;
    const cur = nodesById.get(node.id);
    if (cur) nodesById.set(node.id, { ...cur, keyboardText: val });
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

  function onToggle(btn: HTMLButtonElement) {
    const id = btn.dataset.id;
    if (!id) return;
    const n = nodesById.get(id);
    if (!n) return;
    const val = !n.checked;
    commit([{ op: 'replace', id: id, checked: val }]);
    // Checking the last open box completes the whole top-level tree, which then
    // drops out of the view (see walk()) — re-render so it disappears. Any other
    // toggle updates the one .todo-checked in place, leaving the caret untouched.
    const root = rootOf(id);
    if (val && root && fullyChecked(root)) {
      seedIfEmpty(); // if that was the last visible tree, drop in a fresh quote
      render();
      return;
    }
    btn.className = val ? 'todo-checked checked' : 'todo-checked';
    btn.textContent = val ? '✓' : '';
    const row = btn.closest<HTMLElement>('.todo-row');
    if (row) row.dataset.checked = val ? '1' : '0';
  }

  function onEnter(line: Line, input: HTMLInputElement) {
    const node = line.node;
    const col = input.selectionStart ?? 0;
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
          checked: false,
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
            checked: false,
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
            checked: false,
            keyboardText: '',
          },
        ]);
      }
      pending = { id: nid, col: 0 };
    }
    render();
  }

  function onBackspaceEmpty(line: Line, input: HTMLInputElement) {
    if (input.value !== '') return false;
    if (nodesById.size <= 1) return false;
    const i = currentLines.findIndex((l) => l.node.id === line.node.id);
    if (i <= 0) return false; // don't delete the first line
    if (childrenOf(line.node.id).length) return false; // don't delete a parent
    const prev = currentLines[i - 1];
    commit([{ op: 'delete', id: line.node.id }]);
    const prevText = nodesById.get(prev.node.id)?.keyboardText || '';
    pending = { id: prev.node.id, col: prevText.length };
    render();
    return true;
  }

  // The topmost visible line has nothing above to merge into, so onBackspaceEmpty
  // leaves it alone. When it's empty and childless, delete it instead and drop
  // the caret onto the line that rises to take its place. Kept separate so Delete
  // reaches only this case, never the merge-up path. No-op on the sole line.
  function onDeleteTopmostEmpty(line: Line, input: HTMLInputElement) {
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

  function onIndent(line: Line, col: number) {
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

  function onOutdent(line: Line, col: number) {
    const node = line.node;
    if (node.parentID == null) return; // already at root
    const parent = nodesById.get(node.parentID);
    if (!parent) return;
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

  function onArrow(dir: 'up' | 'down', line: Line, input: HTMLInputElement) {
    const i = currentLines.findIndex((l) => l.node.id === line.node.id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= currentLines.length) {
      // No line in that direction: snap the caret to the far edge of this line
      // (ArrowDown off the last line → end; ArrowUp off the first → start).
      const col = dir === 'down' ? input.value.length : 0;
      input.setSelectionRange(col, col);
      return;
    }
    moveCaret(currentLines[i], currentLines[j], input.selectionStart ?? 0);
  }

  // ── Event wiring (delegated, so re-renders don't re-attach) ──
  list.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset && t.dataset.id && t.tagName === 'INPUT') {
      const line = lineOf(t.dataset.id);
      if (line) onInput(line.node, t);
    }
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
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
      if (e.shiftKey) onOutdent(line, t.selectionStart ?? 0);
      else onIndent(line, t.selectionStart ?? 0);
    }
  });
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest ? t.closest<HTMLButtonElement>('button[data-id]') : null;
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
    return (function build(parentID: string | null, depth: number): unknown[] {
      return (kids.get(parentID) || [])
        .filter((n) => !(depth === 0 && fullyChecked(n, kids)))
        .map((n) => ({
          id: n.id,
          checked: n.checked,
          keyboardText: n.keyboardText,
          position: n.position,
          children: build(n.id, depth + 1),
        }));
    })(null, 0);
  }
  // ── Last deployment timestamp: the info-box ships all four info-pills in
  // the page; this fills each one's secondary text by id and drops the pills
  // that don't apply. Live keeps #deployed-timestamp, localhost keeps
  // #page-edit-timestamp and #commit-timestamp; #on-branch-branchname
  // survives both. Decided client-side by hostname (the dev-server proxy
  // rewrites the server-side one). LAST_DEPLOYMENT_TIMESTAMP is inlined into
  // the page. ──
  (function renderLastDeploymentTimestamp() {
    const s = LAST_DEPLOYMENT_TIMESTAMP;
    // Format "2026-07-08" + "09:52:36" → "9:52am on Jul 8"
    function formatStampTime(date: string, time: string) {
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
    function fillPill(id: string, value: string) {
      const pill = document.getElementById(id);
      if (!pill) return;
      const slot = pill.querySelector('.pill-text-secondary');
      if (slot) slot.textContent = value;
    }
    function dropPill(id: string) {
      const pill = document.getElementById(id);
      if (pill) pill.remove();
    }
    fillPill('on-branch-branchname', '#' + s.branch);
    if (window.location.hostname === 'localhost') {
      fillPill(
        'page-edit-timestamp',
        formatStampTime(s.pageEdit.date, s.pageEdit.time),
      );
      fillPill('commit-timestamp', formatStampTime(s.commit.date, s.commit.time));
      dropPill('deployed-timestamp');
    } else {
      fillPill('deployed-timestamp', formatStampTime(s.deploy.date, s.deploy.time));
      dropPill('page-edit-timestamp');
      dropPill('commit-timestamp');
    }
  })();

  // Tab title mirrors the last-deployment-timestamp's hostname check: live is
  // "Scratchpad", localhost is tagged so the two tabs are distinguishable.
  document.title =
    window.location.hostname === 'localhost'
      ? 'Scratchpad — localhost'
      : 'Scratchpad';

  function copyAsJSON(data: unknown) {
    const text = JSON.stringify(data, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  }
  function onActionPill(id: string, build: () => unknown) {
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
        checked: false,
        keyboardText: quoteLine(),
      },
    ]);
  }

  // ── Boot ──
  loadTree().then(() => {
    seedIfEmpty();
    render();
    const inputs = list.querySelectorAll<HTMLInputElement>('input[data-id]');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });
}
