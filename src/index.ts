// x.michaeltowle.io — the scratchpad Worker.
//
// Only /scratchpad and its API resolve; every other path is a real 404 (no
// catch-all shell). API requests are forwarded to the one TodoTree Durable
// Object, which owns all state. GET /scratchpad serves the editor page — the
// client is serialized into the page via toString().

export { TodoTree } from './tree.ts';

// Imported as text (see the Text rule in wrangler.toml) and inlined into the
// page head as a data-URI favicon — no extra route, so routing stays 404-only.
import iconSvg from './scratchpad-pencil-icon.svg';

// The browser client, bundled by scripts/build-client.mts and imported here as a
// string of JS, which page() inlines into a <script>. It never runs in the Worker.
// (It cannot: it is written against the DOM, and the Worker has no DOM.)
import { clientBundle } from '../generated/client-bundle.ts';

const API_PATHS = new Set([
  '/scratchpad/tree',
  '/scratchpad/mutations',
  '/scratchpad/socket', // WebSocket upgrade; the DO answers it, live-sync's read channel
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
function treeStub(env: Env): DurableObjectStub {
  return env.TREE.get(env.TREE.idFromName('root'));
}

function page(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(iconSvg)}">
<title>Scratchpad</title>
<style>
/* Laptop-first three-column shell: the plan-box on the left, the editable plan-page in the
   middle, and the read-only today-box + deploy stamp on the right. */
:root{--page-w:760px}
html,body{margin:0;padding:0;background:#f1ebdf;scrollbar-width:none;color:#43392a;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}
.scroll{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;gap:24px;padding:28px 24px;box-sizing:border-box}

/* The left/right panels flank the plan-page. Each is a column of sidebar-boxes. */
.sidebar{flex:0 0 260px;align-self:stretch;display:flex;flex-direction:column;gap:16px;min-width:0}

/* The plan-page: the editable card you plan on. Its <h1> is the plan's name (contenteditable,
   Notion-style); #todo-container below it holds the rows. */
#plan-page{flex:0 1 var(--page-w);max-width:100%;min-width:0;background:#faf5ea;border:1px solid rgba(120,90,40,.11);border-radius:10px;padding:56px 72px 200px;box-sizing:border-box}
#plan-page h1{margin:0 0 22px;font-size:30px;font-weight:600;line-height:1.25;color:#43392a;outline:none;overflow-wrap:anywhere;cursor:text}
#plan-page h1:empty::before{content:"Untitled plan";color:#cbb894}

.todo-row{display:flex;align-items:flex-start;gap:12px;padding:3px 0}
/* The checkbox doubles as the drag handle — grab a todo here and drop it on a plan pill. */
.todo-checked{flex:none;width:18px;height:18px;border-radius:4px;border:1.5px solid #cbb894;background:transparent;margin-top:4px;cursor:grab;display:flex;align-items:center;justify-content:center;padding:0;color:#fff;font-size:12px;line-height:1}
.todo-checked:active{cursor:grabbing}
.todo-checked.checked{border-color:#9c7a3c;background:#9c7a3c}
/* A textarea, not an <input>: long todos wrap instead of scrolling out of sight. The
   client's autosize() sets its height to fit, so resize/scrollbars stay off; overflow-wrap
   breaks a word too long for the line rather than forcing a horizontal scroll. */
.todo-row textarea{flex:1;min-width:0;box-sizing:border-box;border:none;outline:none;background:transparent;font-family:inherit;font-size:16px;line-height:1.7;color:#43392a;padding:0;margin:0;display:block;resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.todo-row[data-checked="1"] textarea{text-decoration:line-through;opacity:.5}
textarea::placeholder{color:#bcad90}

/* Sidebar boxes: cream cards holding pills. */
.pill-container{box-sizing:border-box;padding:12px;background:#faf5ea;border:1px solid rgba(120,90,40,.11);border-radius:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.5;color:#333}
/* The deploy stamp sinks to the foot of the right panel. */
.info-box{margin-top:auto;font-size:11px;gap:6px}
.pill{display:flex;flex-wrap:wrap;gap:5px;align-items:baseline;background:transparent;border-radius:4px;padding:5px 8px}
.pill-text-primary{color:#333}
.pill-text-secondary{color:#b07a30;white-space:nowrap}

/* Plan pills: click to open a plan's page; drag a todo here to move it into that plan.
   .plan-active marks the plan you are looking at, .plan-over the drag-hover target. */
.plan{cursor:pointer;justify-content:space-between;transition:background .12s}
.plan .pill-text-primary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plan:hover{background:#f1e7d3}
.plan.plan-active{background:#efe3ca;box-shadow:inset 3px 0 0 #9c7a3c}
.plan.plan-active .pill-text-primary{color:#8a5a1e;font-weight:600}
.plan.plan-over{background:#eadcbe;box-shadow:inset 0 0 0 1px #9c7a3c}
/* The one control in the plan-box: make a new plan. */
.add-plan{cursor:pointer;color:#a98a55;margin-top:4px;transition:background .12s,color .12s}
.add-plan:hover{background:#f1e7d3;color:#8a5a1e}

/* Priority-box: todos ranked by dragging them here, gathered across every plan (like Today).
   Dragging a ranked row within the box reorders it (priority-rule-above/below marks the drop
   line); dragging it out to anywhere else in the page clears its rank — priority-leaving fades
   the row while the drag currently sits outside the box, as a "this will unrank it" cue. A
   just-checked row stays, crossed out, through the rest of the day it was finished, same as
   Today (see priorityTodos). */
.priority-head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a98a55;padding:2px 8px 6px}
.priority-todo{display:flex;align-items:flex-start;gap:8px;padding:4px 8px;color:#43392a;border-radius:4px}
.priority-todo-text{min-width:0;overflow-wrap:anywhere}
.priority-todo[data-checked="1"] .priority-todo-text{text-decoration:line-through;opacity:.5}
.priority-todo .todo-checked{margin-top:1px}
.priority-todo.priority-rule-above{box-shadow:inset 0 2px 0 0 #9c7a3c}
.priority-todo.priority-rule-below{box-shadow:inset 0 -2px 0 0 #9c7a3c}
.priority-todo.priority-leaving{opacity:.35}
.priority-empty{padding:4px 8px;color:#bcad90;font-style:italic}

/* Today-box: what is due today, gathered across every plan. The text is read-only, but each row
   carries a working checkbox to tick the todo off. A just-checked row stays in the box, crossed
   out, through the rest of the day it was finished (see todayTodos), rather than leaving right
   away — data-checked mirrors a plan-page row's strike-through. */
.today-head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a98a55;padding:2px 8px 6px}
.today-todo{display:flex;align-items:flex-start;gap:8px;padding:4px 8px;color:#43392a;border-radius:4px}
.today-todo-text{min-width:0;overflow-wrap:anywhere}
.today-todo[data-checked="1"] .today-todo-text{text-decoration:line-through;opacity:.5}
/* The today checkbox reuses .todo-checked's look, but it is a plain control here, not a drag
   handle — so a pointer cursor, and a smaller top-margin to sit against the 13px today text. */
.today-todo .todo-checked{cursor:pointer;margin-top:1px}
.today-empty{padding:4px 8px;color:#bcad90;font-style:italic}

/* Below laptop width the three columns stack: plans, then the plan-page, then today. */
@media (max-width:1000px){
  .scroll{flex-direction:column;align-items:center}
  .sidebar{flex:none;align-self:auto;width:100%;max-width:var(--page-w)}
  #left-sidebar{order:1}
  #plan-page{order:2;width:100%;padding:40px 24px 80px}
  #right-sidebar{order:3}
  .info-box{margin-top:0}
}
</style>
</head>
<body>
<div class="scroll" id="scroll">
<div class="sidebar double-sidebar" id="left-sidebar">
<div class="sidebar-box pill-container plan-box" id="plan-box"></div>
</div>
<div id="plan-page">
<h1 contenteditable="true" spellcheck="false"></h1>
<div id="todo-container"></div>
</div>
<div class="sidebar double-sidebar" id="right-sidebar">
<div class="sidebar-box pill-container priority-box" id="priority-box"></div>
<div class="sidebar-box pill-container today-box" id="today-box"></div>
<div class="sidebar-box pill-container info-box">
<div class="pill info-pill" id="deployed-timestamp"><span class="pill-text-primary">deployed</span> <span class="pill-text-secondary"></span></div>
<div class="pill info-pill" id="on-branch-branchname"><span class="pill-text-primary">from branch</span> <span class="pill-text-secondary"></span></div>
</div>
</div>
</div>
<script>
${clientBundle}
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
