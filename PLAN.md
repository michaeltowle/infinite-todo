# x.michaeltowle.io — a private, amorphous apps lab

## What this is

A private, experimental workspace hosted at **x.michaeltowle.io**. It starts as a
todo/planning app but is deliberately **nameless and open to change** — many views
over the same data, many capture methods, and room for more private apps later.
Not customer-facing, so it isn't constrained by having to stay simple for
strangers: the goal is **lots of views for lots of perspectives** on my todos and
planning. Everything here is private to me.

## Decisions locked in

- **Home: `x.michaeltowle.io`** — a short, nameless private subdomain. This is the
  **privacy boundary**: one Cloudflare Access policy over the whole host makes
  *everything* under it private automatically — every future view and every future
  app, with zero per-path config. The boundary never has to move as the inside
  mutates. Keeps the apex `michaeltowle.io` free for any public use later.
- **Auth: Cloudflare Access (Zero Trust), email one-time PIN**, allow-listed to
  `michaeltowle@proton.me`. Sits at the edge in front of the Worker — no auth code
  in the app. Works on **any machine, including a locked-down public university
  computer**: no dependency on 1Password, Bluetooth, or a modern browser — just a
  6-digit code in Proton. Free at this scale (Zero Trust covers up to 50 users).
- **Compute: one Cloudflare Worker.** Serves the single-page app shell *and* a
  `/api/*` JSON layer. Chosen over Pages: this is one evolving full-stack app with
  its own router, and Workers is Cloudflare's strategic platform.
- **Data: Cloudflare D1 (SQLite)** behind the API, so todos persist and sync
  across every device.
- **Front end: a single-page app with a client-side router.** Views are cheap
  routes (`/todos`, `/today`, `/thisweek`, …) over one API — a new view is a route
  plus a query, not a new page or endpoint.
- **More apps later: path prefixes** under the same subdomain
  (`x.michaeltowle.io/todo/*`, `/notes/*`, …) — one login covers all of them.

## The core principle: stable data, cheap views

The data model and the `/api/*` layer are the **stable core**. Everything else is
disposable:

- **Views** (`/todos`, `/today`, `/thisweek`, `/kanban`, …) are thin client-side
  routes that each query the same store differently. Dial up as many perspectives
  as I want without touching the backend.
- **Capture methods** are the same idea from the input side: one stable API, many
  thin entry points into it (quick-add, a `/capture` view, a bookmarklet, etc.).

Get the core right and the amorphous surface is free to churn.

## Architecture

```
Browser (any machine — laptop, phone, public university PC)
        │  https://x.michaeltowle.io/*
        ▼
Cloudflare Access ──unauthenticated?──► email one-time-PIN login (CF-hosted)
        │  policy: allow only michaeltowle@proton.me  (covers the WHOLE subdomain)
        │  on success sets CF_Authorization session cookie (long-lived on my devices)
        ▼
Cloudflare Worker
        │  ├─ /api/*   → JSON over D1
        │  └─ /*       → SPA shell (client-side router renders the view)
        ▼
D1 (SQLite) ── stores todos: id, text, done, depth, created_at, …
```

Because Access covers the entire host, there is **no app-level login** for bots to
spam — unauthenticated requests never reach the Worker, and the Access screen only
lets my allow-listed email through. Bots and strangers only ever see the login.

## Roadmap (milestones)

1. **Get hosted on CF** — the Worker serves the SPA shell at `x.michaeltowle.io`,
   reachable from any laptop. *Test:* `https://x.michaeltowle.io/` returns 200, not
   a 404. (Publicly visible at this stage — fine while it's a placeholder; #2 locks
   it down before any real content lands.)
2. **Lock it down** — one Cloudflare Access application over the whole subdomain,
   email OTP, allow-list = my email. Whitelisted device: long session, log in
   rarely. Any other device / public PC: fresh code each time, don't persist the
   session. Bots and everyone else: only ever the Access login.
3. **Persistence** — D1 + `/api/*`; wire the SPA to load on start and save on
   change. Every view reads and writes the same store, so todos sync across
   devices and sessions.

## Build order (get rolling)

1. **Scaffold the Worker** — `wrangler.toml`, `src/index.js`, `package.json`.
   `workers_dev = false` (no bypass URL around Access later).
2. **Serve a shell** — `/api/*` reserved for JSON; everything else returns the SPA
   shell so client-side routes (`/todos`, `/today`, …) all resolve.
3. **Deploy + custom domain** — attach `x.michaeltowle.io` to the Worker (DNS
   record + Worker custom domain / route). → satisfies milestone #1.
4. **Cloudflare Access** — add a self-hosted Access app for the whole subdomain,
   Allow policy for my email, one-time PIN, long session. → milestone #2.
5. **D1 + API + wire the SPA** → milestone #3.

## Open decisions (non-blocking — start now, decide later)

- **Front-end stack.** Start minimal: vanilla JS + a tiny client-side router, zero
  build step, ideal for an experimental surface. The `/api/*` boundary makes the
  front end replaceable, so swapping to Preact/Svelte later costs nothing on the
  backend. Not a blocker for milestone #1.
- **Access session length** — proposed ~1 month for my devices.
- **Verify the Access JWT in the Worker?** Defense-in-depth so nothing can reach
  the Worker around Access. Minimum viable is `workers_dev = false` + host-locked
  routing; verifying `Cf-Access-Jwt-Assertion` in code is the belt-and-suspenders
  option. Not needed for #1.
