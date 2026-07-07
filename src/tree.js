// TodoTree — the scratchpad's Durable Object and single source of truth.
//
// State model: one storage entry per node under `element:<id>`, holding the
// stored fields of a todo-line-item ({ id, parentID, position, checkbox,
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
const MUTABLE_FIELDS = ["checkbox", "keyboardText", "parentID", "position"];

export class TodoTree {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
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
  async readTree() {
    const nodes = [...(await this.allNodes()).values()];
    const treeRevision = (await this.storage.get(REVISION_KEY)) ?? 0;
    return Response.json({ treeRevision, nodes });
  }

  // POST /scratchpad/mutations → apply a batch atomically, return { treeRevision }.
  async applyMutations(request) {
    let batch;
    try {
      batch = await request.json();
    } catch {
      return Response.json({ error: "bad_json" }, { status: 400 });
    }
    if (!Array.isArray(batch)) {
      return Response.json({ error: "expected_batch" }, { status: 400 });
    }

    for (const mutation of batch) {
      await this.applyOne(mutation);
    }

    const treeRevision = ((await this.storage.get(REVISION_KEY)) ?? 0) + 1;
    await this.storage.put(REVISION_KEY, treeRevision);
    return Response.json({ treeRevision });
  }

  async applyOne(mutation) {
    const key = ELEMENT_PREFIX + mutation.id;

    switch (mutation.op) {
      case "insert": {
        await this.storage.put(key, {
          id: mutation.id,
          parentID: mutation.parentID ?? null,
          position: mutation.position,
          checkbox: mutation.checkbox ?? false,
          keyboardText: mutation.keyboardText ?? "",
        });
        return;
      }
      case "replace":
      case "move": {
        const existing = await this.storage.get(key);
        if (!existing) return; // nothing to patch
        const patched = { ...existing };
        for (const field of MUTABLE_FIELDS) {
          if (field in mutation) patched[field] = mutation[field];
        }
        await this.storage.put(key, patched);
        return;
      }
      case "delete": {
        await this.deleteSubtree(mutation.id);
        return;
      }
      // Unknown op: ignore, so one bad entry can't poison the whole batch.
    }
  }

  // Delete a node and every descendant. Deleting a line removes its subtree.
  async deleteSubtree(rootID) {
    const childrenByParent = new Map();
    for (const node of (await this.allNodes()).values()) {
      const siblings = childrenByParent.get(node.parentID) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentID, siblings);
    }

    const stack = [rootID];
    while (stack.length) {
      const id = stack.pop();
      await this.storage.delete(ELEMENT_PREFIX + id);
      for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
    }
  }

  // All stored nodes as a Map(key → node).
  // NOTE: single list() call — fine at scratchpad scale (single-digit MB). If
  // the tree grows past storage.list()'s return cap, paginate with a cursor.
  allNodes() {
    return this.storage.list({ prefix: ELEMENT_PREFIX });
  }
}
