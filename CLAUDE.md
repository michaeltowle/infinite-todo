# CLAUDE.md

Operating instructions for Claude on this repo. Read before acting.

## Hard rules (do not violate without explicit user say-so)

1. **No naming without approval — for names that matter.** For anything
   _structural or user-facing_ I get the user's pick: classes, files,
   routes/paths, fields/attributes, enums and their values, bindings, storage
   keys, wire/message shapes, node types, and any UI-facing name. When such a
   name is needed I **propose 3–5 candidates** (recommended pick first,
   XML-native option leading) — I don't ask open-endedly and I don't adopt
   one myself; I use only sanctioned names (see Approved names).
   **Exempt — name freely:** internal helper functions, local variables,
   private closures, and other pure implementation details not part of the
   data model, wire contract, or UI.
2. **No UI elements or copy without approval.** I may not add, remove, or
   reword any UI element or any user-facing text/copy without the user's
   say-so. This includes labels, placeholders, headings, button text,
   messages, and microcopy.

If a task can't proceed without a new name or new UI/copy, surface that and
wait — don't guess.

## Naming conventions

- **Prefer XML / XPath / DOM terminology** wherever a concept has an
  established equivalent there — the data model is an XML-ish document tree,
  so this recurs. When proposing names (see rule 1), lead with the
  XML-native option and cite its provenance.
- Adopted so far: `position` (XPath `position()` — sibling-relative),
  `documentPosition` (DOM `compareDocumentPosition` — absolute order),
  `depthLevel` (XSLT `<xsl:number level>` — nesting depth).

## What this is

`infinite-todo` — a private hierarchical todo editor served at
`x.michaeltowle.io` on a single Cloudflare Worker. At present, the only available view is the
**scratchpad**.

### Frame (mental model to adopt)

- The scratchpad is a hierarchy of **todo-nodes**.
- Under the hood, nodes are **typed**. The type of a node is determined by
  the user's input — parsed from what they type, analogous to command-line
  optparse. (More types are planned; complexity target: somewhat complex,
  well short of Notion.)
- Current scope: exactly **one** node type, **todo-line-item**.
  - Stored per node: `id` (stable), `checkbox` (bool), `keyboardText` (str),
    `parentID` (its parent's `id`; null/absent at root), `position` (sibling
    sort key — the stored, _relative_ order value).
  - Computed at render, NOT stored: `documentPosition` (int — the _absolute_
    line in the flattened tree), `depthLevel` (int — nesting depth).
  - `checkbox`, `keyboardText`, `id`, `parentID`, `position`,
    `documentPosition`, `depthLevel`, and the type name are user-approved.
    Do not add, rename, or drop fields without say-so.

## Architecture (decided)

- **Persistence: a Durable Object.** The tree lives in memory in the DO;
  each node persists under its own storage key so a single-node edit writes
  one small key, not the whole document. The DO's single-threaded execution
  serializes writes (no last-write-wins clobbering).
- **Node identity: stable `id`.** Generated with `crypto.randomUUID()`. Never
  changes when a node moves; the storage key derives from it (scheme pending).
- **Hierarchy: parent-pointer model.** Each node stores `parentID`;
  `depthLevel` is computed at render by walking to the root.
- **Ordering is persisted, not derived from screen position.** Each node
  stores `position` — a per-sibling fractional/lexicographic sort key; a move
  rewrites just that node — no renumbering. `documentPosition` is computed at
  render by sorting siblings on `position` and doing a pre-order walk. Because
  a single DO is the sole source of truth, order is authoritative and syncs
  across devices with no merge step.
- **Wire format: deltas, not whole-document rewrites.** An edit sends the
  change to one node, not the entire tree.
- **File as snapshot, not hot path.** An XML/OPML-style document is a
  periodic snapshot/export artifact, never the live write path. (Format not
  finalized.)
- **Routing: only `/scratchpad` resolves.** Every other path returns a real
  server `404`. No catch-all SPA shell — the previous Worker served the
  shell for all non-`/api` paths (faking 404s client-side); do not
  reintroduce that.
- **Storage & wire vocabulary.** DO storage key per node = `element:<id>`.
  Edits travel as a `mutation` whose `op` is one of `insert` | `delete` |
  `replace` | `move` (from the XQuery Update Facility). `TodoTree` lives in
  its own file `src/tree.js`, imported by `src/index.js`.
- **API.** `GET /scratchpad/tree` → the full tree. `POST /scratchpad/mutations`
  → a **batch** (array) of `mutation`s, applied atomically in one DO request;
  returns `{ treeRevision }` (a monotonic counter). The client holds the whole
  tree and recomputes `documentPosition`/`depthLevel` locally; `treeRevision`
  lets it detect drift and refetch.

## Approved names (usable without asking)

scratchpad · todo-node · todo-line-item · `checkbox` · `keyboardText` ·
`position` · `documentPosition` · `depthLevel` · `infinite-todo` ·
`x.michaeltowle.io` · `/scratchpad` · `TodoTree` (Durable Object class) ·
`TREE` (DO binding) · `src/index.js` (entry file) · `id` (stable node id) ·
`parentID` (parent link) · `element:` (storage-key prefix) · `mutation` (edit
message) · `op` (mutation kind) with values `insert` / `delete` / `replace` /
`move` · `src/tree.js` (DO class file) · `tree` & `mutations` (API path
segments) · `treeRevision` (monotonic write counter) · `optparse` (line parser
— currently a stub) · `root` (the single DO instance name) · UI copy:
`Scratchpad` (tab title, live) / `Scratchpad — localhost` (tab title,
localhost), `To-do` (input placeholder), `copy as json` / `raw array` /
`nested object tree` (the two `#copy-onpage-todos-as-json` buttons: primary + secondary text),
`page edit` / `commit` (localhost info-pill labels),
`deployed` (live deploy-stamp pill label),
`on branch` (info-pill label, shown both localhost and live; branch name prefixed with `#`). All stamp times are
US Eastern (`America/New_York`), formatted as `h:mmam/pm on Mon D` (e.g., `9:52am on Jul 8`).

**Layout & dev-helper names.** `#inner-page` (center column) holds
`#todo-scratchpad` (the render target for todo rows). `#left-outer` /
`#right-outer` are the flanking `.outer-page`s (desktop-only). A `.pill-container`
is a panel pinned in an outer page; both live in `#left-outer` — `#dev-helpers`
(top) holds `#copy-onpage-todos-as-json` (two `.pill.button-pill` action
buttons); `#deploy-stamp` (bottom) holds the versioning line and its
`.pill.info-pill`s. Every pill shares the `.pill` base and carries a
`.pill-text-primary` label + `.pill-text-secondary` bronze value (the secondary
wraps to its own line on overflow).

**Files.** `scripts/generate-build-timestamp.mjs` (build-timestamp generator),
`src/deploy-stamp.js` (its generated output, imported by `src/index.js`),
`src/scratchpad-pencil-icon.svg` (favicon source, inlined as a data-URI),
`personality/quotes.json` (list of `{ quoteText, quoteAuthor }` POJOs, bundled

- inlined as the page global `QUOTES`; used to seed a fresh todo when the
  scratchpad empties out — line format `"<quoteText>" -- <quoteAuthor>`).

Everything else structural or user-facing needs approval; internal helper
functions and locals are named freely (rule 1). Still pending: the node-type
enum, for when real node types arrive.

## Repo notes

- Cloudflare Worker; config in `wrangler.toml`. Entry is `src/index.js`
  (approved); `main` points there. DO binding `TREE` → class `TodoTree` is
  wired (binding + `v1` migration in `wrangler.toml`).
- **Build stamp.** `npm run dev` / `npm run deploy` run `pre` hooks that
  regenerate `src/deploy-stamp.js` via `scripts/generate-build-timestamp.mjs`
  (dev = newest `src/` edit + last commit; deploy = deploy time). Deploy with
  `npm run deploy`, not raw `wrangler deploy`, or the stamp goes stale. The page
  decides live-vs-localhost **client-side** (`window.location.hostname`); the
  dev-server's server-side hostname is unreliable.
- **Deploy = production.** Only one Worker (`x.michaeltowle.io`,
  `workers_dev = false`); a deploy overwrites the live site (no staging env).
  Works from any git branch — `wrangler` bundles the working tree, not a branch.
- `.svg` files import as text (Text rule in `wrangler.toml`) for the inlined
  favicon.
- Not gitignored: source, config, `package-lock.json`, `src/deploy-stamp.js`
  (tracked; overwritten each build). Ignored: `node_modules/`, `.wrangler/`,
  `.dev.vars`.
- Commit/push only when asked.
