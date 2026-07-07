# CLAUDE.md

Operating instructions for Claude on this repo. Read before acting.

## Hard rules (do not violate without explicit user say-so)

1. **No naming without approval — for names that matter.** For anything
   *structural or user-facing* I get the user's pick: classes, files,
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
`x.michaeltowle.io` on a single Cloudflare Worker. The app is the
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
    sort key — the stored, *relative* order value).
  - Computed at render, NOT stored: `documentPosition` (int — the *absolute*
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
segments) · `treeRevision` (monotonic write counter)

Everything else needs approval — including helper function names and any
node-type enum.

## Repo notes
- Cloudflare Worker; config in `wrangler.toml`. Entry is `src/index.js`
  (approved); `main` must point there. DO binding `TREE` → class `TodoTree`
  still needs wiring (binding + migration).
- Not gitignored: source, config, `package-lock.json`. Ignored:
  `node_modules/`, `.wrangler/`, `.dev.vars`.
- Commit/push only when asked.
