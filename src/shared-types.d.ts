// Shared shapes for both sides of the wire. Declaration-only (no runtime code)
// and global (no top-level import/export), so the worker project and the client
// project can each pick it up without either one owning it as a compiled input.

// The stored fields of a todo-line-item — one storage entry per node, under
// `element:<id>`. `documentPosition` and `depthLevel` are deliberately absent:
// they are computed at render, never stored.
interface Todo {
  id: string;
  parentID: string | null;
  position: number;
  checked: boolean;
  keyboardText: string;
  // Which bucket this todo's tree belongs to (see buckets.ts): a YYYY-MM-DD date,
  // "someday" or "big-ticket" for the two dateless buckets, or null for the Unbucketed
  // capture inbox. Only the active bucket's todos are projected onto the page at a
  // time (see project()/inBucket) — the rest are waiting, not gone.
  hideUntil: string | null;
}

// An edit travels as a mutation, never a whole-document rewrite. Three ops, ours
// (they were once the XQuery Update Facility's insert/delete/replace/move, but
// `replace` and `move` were one operation to the store and only ever differed in
// intent, so they are now the single `edit`). Modelled as a discriminated union on
// `op`, so the compiler knows a `create` carries a full node while an `edit`
// carries only the fields it means to overwrite — and a `delete` carries nothing
// but the id.
type Mutation = CreateMutation | EditMutation | DeleteMutation;

interface CreateMutation extends Todo {
  op: "create";
}

// Patch the named fields of an existing node, leave the rest alone. Carries
// keyboardText when you type, checked when you click a box, and parentID +
// position together when you indent or outdent.
interface EditMutation extends Partial<Omit<Todo, "id">> {
  op: "edit";
  id: string;
}

interface DeleteMutation {
  op: "delete";
  id: string;
}

// One wall-clock reading, US Eastern, as written by the deployment-timestamp
// generator.
interface StampTime {
  date: string;
  time: string;
}

// The generated last-deployment-timestamp payload, inlined into the page.
interface DeploymentStamp {
  branch: string;
  deploy: StampTime;
}

// A projected line: a node plus the depth project() found it at. `depth` is
// depthLevel — computed here, never stored.
interface Line {
  node: Todo;
  depth: number;
}
