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

// Build-time values (deploy time; or latest src edit + last commit for dev),
// written by scripts/generate-deployment-timestamp.mts. Rendered into the info-pills.
import { lastDeploymentTimestamp } from './last-deployment-timestamp.ts';

// The browser client. Imported for its *source*, not its behaviour — page()
// serializes it with toString() and inlines it into the page. It never runs in
// the Worker. (See client-main.ts: it must stay self-contained.)
import { clientMain } from './client-main.ts';

const API_PATHS = new Set(['/scratchpad/tree', '/scratchpad/mutations']);

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
@media (max-width:600px){#todo-container{padding:32px 16px 320px}}
.todo-row{display:flex;align-items:flex-start;gap:12px;padding:3px 0}
.todo-checked{flex:none;width:18px;height:18px;border-radius:4px;border:1.5px solid #cbb894;background:transparent;margin-top:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#fff;font-size:12px;line-height:1}
.todo-checked.checked{border-color:#9c7a3c;background:#9c7a3c}
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
var LAST_DEPLOYMENT_TIMESTAMP = ${JSON.stringify(lastDeploymentTimestamp)};
;(${clientMain.toString()})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
