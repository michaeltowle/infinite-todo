// TodoTree — the scratchpad's Durable Object and single source of truth.
//
// State model: one storage entry per node under `element:<id>`, holding the
// stored fields of a todo-line-item ({ id, parentID, position, checked,
// keyboardText }). `documentPosition` and `depthLevel` are NOT stored — the
// client computes them by sorting siblings on `position` and walking the tree.
// A separate `treeRevision` counter is bumped on every write batch.
//
// Edits arrive as a batch of `mutation`s (POST /scratchpad/mutations); the DO
// applies them and returns the new `treeRevision`. The DO's input gate
// serializes requests and coalesces the batch's writes into one atomic commit,
// so no explicit transaction is needed.

const ELEMENT_PREFIX = "element:";
const REVISION_KEY = "treeRevision";

// Fields a `replace`/`move` mutation is allowed to overwrite on an existing node.
const MUTABLE_FIELDS = ["checked", "keyboardText", "parentID", "position"] as const;

// What actually arrives over the wire: whatever the client posted. Every field
// is optional and unverified — this is untrusted JSON, so the code below keeps
// its defensive defaults rather than trusting a Mutation-shaped promise.
type IncomingMutation = Partial<Record<(typeof MUTABLE_FIELDS)[number], unknown>> & {
  op?: unknown;
  id?: unknown;
};

// A node as it may sit in storage *before* the migration below has run. Nodes
// written prior to the checkbox→checked rename still carry `checkbox`.
type LegacyTodo = Omit<Todo, "checked"> & {
  checked?: boolean;
  checkbox?: boolean;
};

export class TodoTree {
  storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
    // Migrate before the DO serves anything: blockConcurrencyWhile holds every
    // inbound request until this resolves, so no read can ever see a half-migrated
    // tree, and no concurrent write can race it.
    state.blockConcurrencyWhile(() => this.renameCheckboxToChecked());
  }

  // One-time data migration: rewrite every node still storing the boolean under
  // `checkbox` so it stores it under `checked`, dropping the dead key. Idempotent
  // and effectively free once storage is clean — one list(), zero writes — so it
  // is safe to leave in place. Logs either way, so `wrangler tail` shows what a
  // given DO wake-up actually did.
  //
  // Once the live DO has reported "already clean", this method and LegacyTodo can
  // be deleted outright.
  async renameCheckboxToChecked(): Promise<number> {
    const stored = await this.storage.list<LegacyTodo>({ prefix: ELEMENT_PREFIX });

    let rewritten = 0;
    for (const [key, node] of stored) {
      if (!("checkbox" in node)) continue;
      const { checkbox, ...rest } = node;
      await this.storage.put(key, { ...rest, checked: node.checked ?? checkbox ?? false });
      rewritten++;
    }

    console.log(
      rewritten > 0
        ? `[migration] checkbox→checked: rewrote ${rewritten} of ${stored.size} node(s)`
        : `[migration] checkbox→checked: already clean (${stored.size} node(s), 0 rewritten)`,
    );
    return rewritten;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/scratchpad/tree") {
      return this.readTree();
    }
    if (request.method === "POST" && pathname === "/scratchpad/mutations") {
      return this.applyMutations(request);
    }
    return new Response("not found", { status: 404 });
  }

  // GET /scratchpad/tree → { treeRevision, nodes: [...stored nodes] }.
  async readTree(): Promise<Response> {
    const nodes = [...(await this.allNodes()).values()];
    const treeRevision = (await this.storage.get<number>(REVISION_KEY)) ?? 0;
    return Response.json({ treeRevision, nodes });
  }

  // POST /scratchpad/mutations → apply a batch atomically, return { treeRevision }.
  async applyMutations(request: Request): Promise<Response> {
    let batch: unknown;
    try {
      batch = await request.json();
    } catch {
      return Response.json({ error: "bad_json" }, { status: 400 });
    }
    if (!Array.isArray(batch)) {
      return Response.json({ error: "expected_batch" }, { status: 400 });
    }

    for (const mutation of batch as IncomingMutation[]) {
      await this.applyOne(mutation);
    }

    const treeRevision = ((await this.storage.get<number>(REVISION_KEY)) ?? 0) + 1;
    await this.storage.put(REVISION_KEY, treeRevision);
    return Response.json({ treeRevision });
  }

  async applyOne(mutation: IncomingMutation): Promise<void> {
    const key = ELEMENT_PREFIX + mutation.id;

    switch (mutation.op) {
      case "insert": {
        await this.storage.put(key, {
          id: mutation.id,
          parentID: mutation.parentID ?? null,
          position: mutation.position,
          checked: mutation.checked ?? false,
          keyboardText: mutation.keyboardText ?? "",
        });
        return;
      }
      case "replace":
      case "move": {
        const existing = await this.storage.get<Todo>(key);
        if (!existing) return; // nothing to patch
        const patched: Record<string, unknown> = { ...existing };
        for (const field of MUTABLE_FIELDS) {
          if (field in mutation) patched[field] = mutation[field];
        }
        await this.storage.put(key, patched);
        return;
      }
      case "delete": {
        await this.deleteSubtree(String(mutation.id));
        return;
      }
      // Unknown op: ignore, so one bad entry can't poison the whole batch.
    }
  }

  // Delete a node and every descendant. Deleting a line removes its subtree.
  async deleteSubtree(rootID: string): Promise<void> {
    const childrenByParent = new Map<string | null, Todo[]>();
    for (const node of (await this.allNodes()).values()) {
      const siblings = childrenByParent.get(node.parentID) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentID, siblings);
    }

    const stack = [rootID];
    while (stack.length) {
      const id = stack.pop()!;
      await this.storage.delete(ELEMENT_PREFIX + id);
      for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
    }
  }

  // All stored nodes as a Map(key → node). Safe to type as Todo: the constructor's
  // migration has already run, so nothing in storage still carries `checkbox`.
  // NOTE: single list() call — fine at scratchpad scale (single-digit MB). If
  // the tree grows past storage.list()'s return cap, paginate with a cursor.
  allNodes(): Promise<Map<string, Todo>> {
    return this.storage.list<Todo>({ prefix: ELEMENT_PREFIX });
  }
}
