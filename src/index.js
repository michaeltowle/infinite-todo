// x.michaeltowle.io — one Worker: SPA shell + /api/* JSON layer.
//
// The API is the stable core; views are cheap client-side routes over it.
// Milestone #1: serve the shell for every non-/api path so client routes resolve.
// Milestone #3: /api/* grows a real D1-backed surface (env.DB).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, ts: Date.now() });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Everything else is the app shell; the client-side router picks the view.
    return new Response(SHELL, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>·</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, sans-serif; }
  header { display: flex; gap: 1rem; padding: .75rem 1rem; border-bottom: 1px solid #8883; }
  header a { text-decoration: none; opacity: .55; }
  header a.active { opacity: 1; font-weight: 600; }
  main { padding: 1.5rem 1rem; max-width: 720px; }
  h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
  .muted { opacity: .5; }
</style>
</head>
<body>
<header id="nav">
  <a href="/todos">todos</a>
  <a href="/today">today</a>
  <a href="/thisweek">thisweek</a>
</header>
<main id="view"></main>
<script>
  // Tiny client-side router. Each view is just a function of the same (future)
  // data pulled from /api/*. Add a route here + a query = a new perspective.
  const views = {
    "/": () => "<h1>·</h1><p class='muted'>pick a view</p>",
    "/todos": () => "<h1>todos</h1><p class='muted'>every line, someday from the API</p>",
    "/today": () => "<h1>today</h1><p class='muted'>a view over the same data</p>",
    "/thisweek": () => "<h1>this week</h1><p class='muted'>another perspective</p>",
  };
  function render() {
    const path = location.pathname;
    const view = views[path] || (() => "<h1>404</h1><p class='muted'>no view at " + path + "</p>");
    document.getElementById("view").innerHTML = view();
    for (const a of document.querySelectorAll("#nav a")) {
      a.classList.toggle("active", a.getAttribute("href") === path);
    }
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a && a.origin === location.origin) {
      e.preventDefault();
      history.pushState(null, "", a.getAttribute("href"));
      render();
    }
  });
  addEventListener("popstate", render);
  render();
</script>
</body>
</html>`;
