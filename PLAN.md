# Deployment Plan — Private hosting at michaeltowle.io/todos

## Goal

Serve the infinite-todo app at **michaeltowle.io/todos**, reachable from any of
my laptops but private to only me. Bots must not be able to crawl it (the reason
the domain isn't currently left live).

## Decisions locked in

- **Host on Cloudflare** — domain michaeltowle.io is already on Cloudflare.
- **App-level auth with a passkey (WebAuthn), NOT Cloudflare Access.**
  Rationale: Cloudflare Access email-OTP means bouncing to Proton and copying a
  code every time. A passkey is stored in **1Password**, which **syncs it across
  all my devices** — so I register it once, ever, and signing in on any laptop is
  just a 1Password/Touch-ID tap. No email round-trip, no password to type.
- **Backend: Cloudflare Worker + D1.** The Worker serves the HTML *and* a small
  JSON API; D1 (Cloudflare's SQLite) stores the todos so they persist and sync
  across laptops.
- Privacy outcome is the same as Access: an unauthenticated visitor (or bot)
  only ever gets the login page — they never reach a byte of todo data.

## Why a backend is required (not just static hosting)

Today [todos.html](todos.html) is a **static file with the todo list
hardcoded in memory** (the `lines` array). If we just static-host it, every
laptop loads the same seed list and every edit vanishes on refresh — it would
not actually be "my todos on any laptop." Persisting each line is an unchecked
item in [MILESTONES.md](MILESTONES.md); this plan builds it.

## Architecture

```
Browser (any laptop, 1Password)
        │  https://michaeltowle.io/todos*
        ▼
Cloudflare Worker  ──serves──►  login page + app HTML
        │                        (passkey via WebAuthn)
        │  verifies passkey, sets signed session cookie (~90 days)
        │  gates the JSON API on that cookie
        ▼
D1 (SQLite)  ── stores todos: id, text, done, depth, created_at
```

- **rpID** (WebAuthn relying-party ID) = `michaeltowle.io`. Passkey is bound to
  the domain, so it works from every browser where 1Password is present.
- Library for the WebAuthn dance on Workers: `@simplewebauthn/server`.

## Implementation steps

- [ ] **Scaffold the Worker project** — `wrangler.toml`, entry Worker, local dev
      via `wrangler dev`.
- [ ] **Create D1 + schema** — table for lines (`id, text, done, depth,
      created_at`) and a table for stored passkey credentials.
- [ ] **Data API** — `GET /todos/api/lines` (load) and a save endpoint
      (`PUT`/`POST`), both gated behind a valid session cookie.
- [ ] **Wire the app to the API** — replace the hardcoded in-memory `lines`
      array in the HTML with load-on-start + save-on-change against the API.
- [ ] **Passkey auth**
  - [ ] Login page + WebAuthn assertion flow → sets signed session cookie.
  - [ ] Session-cookie middleware protecting the app HTML and the API.
  - [ ] **First-passkey bootstrap** (see Open questions) — you can't require
        login to register your *first* passkey.
- [ ] **Serve the app HTML from the Worker at `/todos`.**
- [ ] **Deploy + route + smoke test** (steps below).
- [ ] **Register my passkey in 1Password**, confirm sign-in works, confirm an
      unauthenticated/incognito visit is blocked.

## Deploy steps (run on the MacBook)

```bash
npm create cloudflare   # or use the scaffolded project in this repo
wrangler login
wrangler d1 create infinite-todo         # note the database_id → wrangler.toml
wrangler d1 execute infinite-todo --file=./schema.sql
wrangler secret put REGISTRATION_TOKEN   # one-time bootstrap secret (see below)
wrangler deploy
# Add the route michaeltowle.io/todos* to the Worker (wrangler.toml routes or dashboard)
```

Then in a browser: hit `michaeltowle.io/todos`, register the passkey once
(using the bootstrap token), and you're set on every laptop thereafter.

## Open questions to resolve

1. **Passkey vs. password.** Passkey is the recommendation (best UX + security,
   syncs via 1Password). Username+password is the simpler fallback if the
   WebAuthn build turns out fiddly. **Leaning passkey.**
2. **First-passkey bootstrap.** Proposed: a registration route protected by a
   secret set via `wrangler secret put`, usable once to enroll the first
   passkey. Alternative: briefly open registration, enroll, then close it.
3. **Multiple passkeys?** Allow enrolling more than one (e.g. a backup) — cheap
   to support, good for recovery.
4. **Session length** — proposed ~90 days sliding.
5. **Path vs. subdomain.** Plan assumes the `/todos` **path** on the apex. If
   the apex already serves other content, confirm the Worker route won't collide
   (a dedicated Worker route on `michaeltowle.io/todos*` is fine either way).

## Current repo state

- [todos.html](todos.html) — working app, static/in-memory (renders,
  checkbox toggle, tab-indent hierarchy, arrow-key caret nav, enter/backspace
  line editing). No persistence, no auth yet.
- [MILESTONES.md](MILESTONES.md), [README.md](README.md) — project notes.
