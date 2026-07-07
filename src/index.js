// x.michaeltowle.io — the scratchpad Worker.
//
// Only /scratchpad and its API resolve; every other path is a real 404 (no
// catch-all shell). API requests are forwarded to the one TodoTree Durable
// Object, which owns all state.

export { TodoTree } from "./tree.js";

const API_PATHS = new Set(["/scratchpad/tree", "/scratchpad/mutations"]);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (API_PATHS.has(pathname)) {
      return treeStub(env).fetch(request);
    }

    if (pathname === "/scratchpad") {
      return page();
    }

    return new Response("not found", { status: 404 });
  },
};

// The single global TodoTree instance. One user, one document → one DO.
function treeStub(env) {
  return env.TREE.get(env.TREE.idFromName("singleton"));
}

// Placeholder shell — no visible copy or UI yet; the real page is Phase B and
// needs sign-off before any elements/text land here.
function page() {
  return new Response(
    "<!doctype html><html lang=en><head><meta charset=utf-8>" +
      "<meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<meta name=robots content='noindex,nofollow'><title></title></head>" +
      "<body></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
