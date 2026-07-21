// TodoTree — the scratchpad's Durable Object and single source of truth.
//
// State model: one storage entry per node under `element:<id>`, holding the
// stored fields of a todo-line-item ({ id, parentID, position, checked,
// keyboardText, planID }), and one entry per plan under `plan:<id>` ({ id, name,
// order, archived }). `documentPosition`, `depthLevel` and a todo's `date` are NOT
// stored — the client computes/derives them. A separate `treeRevision` counter is
// bumped on every write batch.
//
// Edits arrive as a batch of `mutation`s (POST /scratchpad/mutations); the DO
// applies them and returns the new `treeRevision`. The DO's input gate
// serializes requests and coalesces the batch's writes into one atomic commit,
// so no explicit transaction is needed.

const ELEMENT_PREFIX = "element:";
const PLAN_PREFIX = "plan:";
const REVISION_KEY = "treeRevision";

// Fields an `edit` mutation is allowed to overwrite on an existing node.
const MUTABLE_FIELDS = [
  "checked",
  "keyboardText",
  "parentID",
  "position",
  "planID",
] as const;

// Fields an `edit-plan` mutation is allowed to overwrite on an existing plan.
const PLAN_MUTABLE_FIELDS = ["name", "order", "archived"] as const;

// What actually arrives over the wire: whatever the client posted. Every field
// is optional and unverified — this is untrusted JSON, so the code below keeps
// its defensive defaults rather than trusting a Mutation-shaped promise. One type
// covers both entities; only the fields for the matched op are ever read.
type IncomingMutation = Partial<
  Record<
    (typeof MUTABLE_FIELDS)[number] | (typeof PLAN_MUTABLE_FIELDS)[number],
    unknown
  >
> & {
  op?: unknown;
  id?: unknown;
};

export class TodoTree {
  storage: DurableObjectStorage;
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/scratchpad/tree") {
      return this.readTree();
    }
    if (request.method === "POST" && pathname === "/scratchpad/mutations") {
      return this.applyMutations(request);
    }
    if (pathname === "/scratchpad/socket") {
      return this.openSocket(request);
    }
    return new Response("not found", { status: 404 });
  }

  // ── Live sync: one socket per open tab, every applied batch fanned out ──
  //
  // Hibernatable (state.acceptWebSocket, not server.accept): a scratchpad sits idle
  // for hours at a time, and the hibernation API lets the DO be evicted from memory
  // while its sockets stay open, waking only when something actually arrives.
  //
  // Each socket is tagged with its tabID, so a batch is never echoed back to the tab
  // that sent it — that tab already applied it optimistically, and re-applying would
  // cost it a render, and with it the caret.
  openSocket(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const tabID = new URL(request.url).searchParams.get("tab") ?? "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [tabID]);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Clients never send over the socket — writes still go over POST, where the
  // outbox can retry them. The socket is a read channel only. Both handlers exist
  // because the hibernation API requires them to route a woken event.
  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}
  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    ws.close(code, reason);
  }

  // Fan a freshly-applied batch out to every tab except the one that made it.
  broadcast(tabID: string, payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (tabID && this.state.getTags(ws).includes(tabID)) continue;
      try {
        ws.send(message);
      } catch {
        // A socket that died between getWebSockets() and send() is not our problem;
        // the client reconnects and resyncs.
      }
    }
  }

  // GET /scratchpad/tree → { treeRevision, nodes: [...stored nodes], plans: [...stored plans] }.
  async readTree(): Promise<Response> {
    const nodes = [...(await this.allNodes()).values()];
    const plans = [...(await this.allPlans()).values()];
    const treeRevision = (await this.storage.get<number>(REVISION_KEY)) ?? 0;
    return Response.json({ treeRevision, nodes, plans });
  }

  // POST /scratchpad/mutations?tab=<tabID> → apply a batch atomically, fan it out to
  // the other tabs, return { treeRevision }.
  //
  // `tab` rides in the query string rather than a header because the client's
  // last-gasp flush goes out via navigator.sendBeacon(), which cannot set headers.
  // It is optional: a batch with no tab (the test helper, curl) is simply broadcast
  // to everyone.
  async applyMutations(request: Request): Promise<Response> {
    const tabID = new URL(request.url).searchParams.get("tab") ?? "";

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

    this.broadcast(tabID, { treeRevision, batch });
    return Response.json({ treeRevision });
  }

  async applyOne(mutation: IncomingMutation): Promise<void> {
    const key = ELEMENT_PREFIX + mutation.id;
    const planKey = PLAN_PREFIX + mutation.id;

    switch (mutation.op) {
      case "create": {
        await this.storage.put(key, {
          id: mutation.id,
          parentID: mutation.parentID ?? null,
          position: mutation.position,
          checked: mutation.checked ?? false,
          keyboardText: mutation.keyboardText ?? "",
          // A child's planID is null and resolved by walking to its root; only a
          // top-level todo carries a real one (see plans.ts).
          planID: mutation.planID ?? null,
        });
        return;
      }
      case "edit": {
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
      case "create-plan": {
        await this.storage.put(planKey, {
          id: mutation.id,
          name: mutation.name ?? "",
          order: mutation.order ?? 0,
          archived: mutation.archived ?? false,
        });
        return;
      }
      case "edit-plan": {
        const existing = await this.storage.get<Plan>(planKey);
        if (!existing) return;
        const patched: Record<string, unknown> = { ...existing };
        for (const field of PLAN_MUTABLE_FIELDS) {
          if (field in mutation) patched[field] = mutation[field];
        }
        await this.storage.put(planKey, patched);
        return;
      }
      case "delete-plan": {
        // Remove the plan record only. A plan is normally retired by archiving, not
        // deleting; if a plan is ever hard-deleted, its todos are reassigned or
        // deleted by the caller in the same batch, so nothing is orphaned here.
        await this.storage.delete(planKey);
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

  // All stored nodes as a Map(key → node).
  // NOTE: single list() call — fine at scratchpad scale (single-digit MB). If
  // the tree grows past storage.list()'s return cap, paginate with a cursor.
  allNodes(): Promise<Map<string, Todo>> {
    return this.storage.list<Todo>({ prefix: ELEMENT_PREFIX });
  }

  // All stored plans as a Map(key → plan). A handful of entries at most.
  allPlans(): Promise<Map<string, Plan>> {
    return this.storage.list<Plan>({ prefix: PLAN_PREFIX });
  }
}
