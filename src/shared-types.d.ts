// Shared shapes for both sides of the wire. Declaration-only (no runtime code)
// and global (no top-level import/export), so the worker project and the client
// project can each pick it up without either one owning it as a compiled input.

// The stored fields of a todo-line-item — one storage entry per node, under
// `element:<id>`. `documentPosition` and `depthLevel` are deliberately absent:
// they are computed at render, never stored. A todo's `date` is absent too — it is
// DERIVED from keyboardText by optparse (see optparse.ts), never stored.
interface Todo {
  id: string;
  parentID: string | null;
  position: number;
  checked: boolean;
  keyboardText: string;
  // Which plan this todo's tree belongs to (see plans.ts). Read at depth 0 only: a
  // subtree travels with its root, so only a root's planID decides which plan its whole
  // tree lives in — a child's is null and resolved by walking to its root (rootOf).
  planID: string | null;
}

// A plan — the named container a todo lives in, and the editable page you look at it on.
// One storage entry per plan, under `plan:<id>`. Unlike a todo, a plan carries its own
// name (shown as the plan-page's <h1> and on its sidebar pill). A plan is archived — it
// "dies" and drops off the sidebar — once every todo in it is checked.
interface Plan {
  id: string;
  name: string; // what the plan calls itself: the plan-page <h1> and the pill label
  order: number; // fractional sort key among plans, same scheme as a node's position
  archived: boolean; // true once all its todos are checked; hidden from the plan-box
  // The local calendar day the plan was born, YYYY-MM-DD. Set once at creation and never
  // edited (so it is absent from PLAN_MUTABLE_FIELDS) — the pill reads it back as the plan's
  // age. Plans created before this field existed carry none; the age readout is then omitted.
  createdAt: string;
}

// An edit travels as a mutation, never a whole-document rewrite. Two entities take
// mutations now — todo-nodes and plans — each with the same three verbs (create, edit,
// delete), kept as distinct ops so one discriminated union covers both. A node op carries
// Todo fields; a plan op carries Plan fields. The DO applies whichever it recognises and
// ignores the rest.
type Mutation =
  | CreateMutation
  | EditMutation
  | DeleteMutation
  | CreatePlanMutation
  | EditPlanMutation
  | DeletePlanMutation;

interface CreateMutation extends Todo {
  op: "create";
}

// Patch the named fields of an existing node, leave the rest alone. Carries
// keyboardText when you type, checked when you click a box, parentID + position
// together when you indent or outdent, and planID when a todo moves plan.
interface EditMutation extends Partial<Omit<Todo, "id">> {
  op: "edit";
  id: string;
}

interface DeleteMutation {
  op: "delete";
  id: string;
}

interface CreatePlanMutation extends Plan {
  op: "create-plan";
}

// Patch a plan's name (an h1 rename), its order (a reorder), or its archived flag.
interface EditPlanMutation extends Partial<Omit<Plan, "id">> {
  op: "edit-plan";
  id: string;
}

interface DeletePlanMutation {
  op: "delete-plan";
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
