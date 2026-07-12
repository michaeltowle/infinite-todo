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
}

// An edit travels as a mutation, never a whole-document rewrite. The four ops
// (insert / delete / replace / move) come from the XQuery Update Facility.
// Modelled as a discriminated union on `op`, so the compiler knows an `insert`
// carries a full node while a `replace`/`move` carries only the fields it means
// to overwrite — and a `delete` carries nothing but the id.
type Mutation = InsertMutation | PatchMutation | DeleteMutation;

interface InsertMutation extends Todo {
  op: "insert";
}

// `replace` and `move` are the same operation to the store: patch the named
// fields of an existing node, leave the rest alone. They differ only in intent —
// `move` is the one that rewrites parentID/position.
interface PatchMutation extends Partial<Omit<Todo, "id">> {
  op: "replace" | "move";
  id: string;
}

interface DeleteMutation {
  op: "delete";
  id: string;
}

// One wall-clock reading, US Eastern, as written by the deployment-timestamp
// generator. Empty strings when the value doesn't apply to that build.
interface StampTime {
  date: string;
  time: string;
}

// The generated last-deployment-timestamp payload, inlined into the page.
interface DeploymentStamp {
  mode: "deploy" | "dev";
  branch: string;
  deploy: StampTime;
  pageEdit: StampTime;
  commit: StampTime;
}

// A projected line: a node plus the depth walk() found it at. `depth` is
// depthLevel — computed here, never stored.
interface Line {
  node: Todo;
  depth: number;
}
