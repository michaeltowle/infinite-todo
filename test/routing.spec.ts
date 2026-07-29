// Routing: the app answers at the bare hostname. It used to live under /scratchpad, and that
// path now survives only as a redirect, so a bookmark or a URL-bar autocomplete still lands on
// the page. Everything else is a real 404 — there is deliberately no catch-all shell.
//
// The API routes (/tree, /mutations, /socket) need no spec of their own: every other file in
// this suite talks to them through the helpers, so the whole suite is their regression net.

import { test, expect } from '@playwright/test';

// 2026-07-29
// The root serves the editor page itself — not a redirect, not a shell.
test('the root serves the editor page', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
  expect(await res.text()).toContain('id="todo-container"');
});

// 2026-07-29
// The old address redirects rather than 404s, permanently, to the root.
test('/scratchpad redirects to the root', async ({ request }) => {
  const res = await request.get('/scratchpad', { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(new URL(res.headers()['location'], 'http://localhost').pathname).toBe('/');
});

// 2026-07-29
// Nothing else resolves. An unknown path is a real 404 — including one under the old prefix,
// which is redirected exactly once, at its own name, and not as a wildcard.
test('an unknown path is a 404', async ({ request }) => {
  expect((await request.get('/nope')).status()).toBe(404);
  expect((await request.get('/scratchpad/nope')).status()).toBe(404);
});
