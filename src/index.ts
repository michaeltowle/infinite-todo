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
@media (max-width:600px){#todo-container{padding:32px 16px 56px}}
.todo-row{display:flex;align-items:flex-start;gap:12px;padding:3px 0}
.todo-checked{flex:none;width:18px;height:18px;border-radius:4px;border:1.5px solid #cbb894;background:transparent;margin-top:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#fff;font-size:12px;line-height:1}
.todo-checked.checked{border-color:#9c7a3c;background:#9c7a3c}
/* A textarea, not an <input>: long todos wrap instead of scrolling out of sight. The
   client's autosize() sets its height to fit, so resize/scrollbars stay off; overflow-wrap
   breaks a word too long for the line rather than forcing a horizontal scroll. */
.todo-row textarea{flex:1;min-width:0;box-sizing:border-box;border:none;outline:none;background:transparent;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#43392a;padding:0;margin:0;display:block;resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.todo-row[data-checked="1"] textarea{text-decoration:line-through;opacity:.5}
textarea::placeholder{color:#bcad90}
/* Pinned over the left gutter while the flankers show; a bottom bar once they
   drop out; hidden on phones. position:fixed lifts it out of the flex row, so
   the flankers still center #todo-container. */
#mono-sidebar{position:fixed;z-index:10;left:5px;top:5px;bottom:5px;width:calc((100vw - var(--page-w)) / 2 - 10px);display:flex;flex-direction:column;justify-content:space-between;gap:6px}
/* Below the flankers' width there is no gutter to pin the sidebar into. Rather than
   float it over the content (the old bottom bar) or hide it (phones used to lose the
   buckets entirely), the page stacks: .scroll becomes a column and #mono-sidebar leaves
   position:fixed to flow in underneath #todo-container. The pills wrap into rows (see the
   .pill-container rule below), so the bucket-box reads as a horizontal bucket-nav. */
@media (max-width:1279px){
  .scroll{flex-direction:column;align-items:center;justify-content:flex-start}
  /* Stacked with the pill-boxes below it, #todo-container reads as the top card of the
     column, so it takes the boxes' look: an 8px inset from the screen edge (matching
     #mono-sidebar's 0 8px padding, via max-width so .scroll keeps it centred) and the same
     8px-radius full hairline border, in place of the desktop full-height left/right rules. */
  #todo-container{max-width:calc(100% - 16px);padding-bottom:56px;border:1px solid rgba(120,90,40,.11);border-radius:8px}
  #mono-sidebar{position:static;z-index:auto;inset:auto;width:100%;max-width:var(--page-w);box-sizing:border-box;padding:0 8px 40px;flex-direction:column;justify-content:flex-start;gap:8px}
}
.pill-container{box-sizing:border-box;padding:12px;background:#faf5ea;border:1px solid rgba(120,90,40,.11);border-radius:8px;display:flex;flex-direction:column;gap:6px;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:#333}
@media (max-width:1279px){.pill-container{flex-direction:row;flex-wrap:wrap;align-items:center}}
.pill{display:flex;flex-wrap:wrap;gap:5px;align-items:baseline;background:transparent;border-radius:3px;padding:4px 7px}
.pill-text-primary{color:#333;white-space:nowrap}
.pill-text-secondary{color:#b07a30;white-space:nowrap}
/* A bucket is both a view and a drop-target. Click one and #todo-container shows only
   its todos (.bucket-active marks the one you are looking through); drag a todo by its
   checkbox and let go here to move it into that bucket. .bucket-over is the drag-hover
   state — the only feedback that the drop will land. */
.bucket{cursor:pointer;transition:background .12s}
.bucket:hover{background:#f1e7d3}
.bucket.bucket-active{background:#efe3ca;box-shadow:inset 3px 0 0 #9c7a3c}
.bucket.bucket-active .pill-text-primary{color:#8a5a1e;font-weight:600}
.bucket.bucket-over{background:#eadcbe;box-shadow:inset 0 0 0 1px #9c7a3c}
/* Hairlines split the ladder into capture / days / dateless. Only meaningful in the
   vertical column (≥1280px); in the wrapped mobile bucket-nav they would just underline
   one pill, so they are scoped out below that width. */
@media (min-width:1280px){
  .bucket.bucket-rule-below{margin-bottom:5px;padding-bottom:9px;border-bottom:1px solid rgba(120,90,40,.18)}
  .bucket.bucket-rule-above{margin-top:5px;padding-top:9px;border-top:1px solid rgba(120,90,40,.18)}
}
/* The checkbox doubles as the drag handle (see render() in the client). */
.todo-checked{cursor:grab}
.todo-checked:active{cursor:grabbing}
</style>
</head>
<body>
<div class="scroll" id="scroll">
<div class="sidebar double-sidebar" id="left-sidebar"></div>
<div id="todo-container"></div>
<div class="sidebar double-sidebar" id="right-sidebar"></div>
<div class="sidebar mono-sidebar" id="mono-sidebar">
<div class="sidebar-box pill-container bucket-box" id="bucket-box"></div>
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
