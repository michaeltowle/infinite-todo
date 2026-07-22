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
  // Which plan this todo's tree belongs to (see plans.ts). Read at depth 0 only: a
  // subtree travels with its root, so only a root's planID decides which plan its whole
  // tree lives in — a child's is null and resolved by walking to its root (rootOf).
  planID: string | null;
  // The todo's own date, "YYYY-MM-DD", or null. Now STORED, not derived: a #date tag typed
  // into the text is "sunk" on blur — optparse extracts it here and the tag is stripped from
  // keyboardText for good, so it stops cluttering the line (see the focusout handler). Legacy
  // nodes carry null and still have their tag in the text; ownDate falls back to parsing those
  // until they are next edited and sunk.
  date: string | null;
  // The moment this todo was typed into existence, as epoch milliseconds — set once at
  // creation, same convention as Plan.createdAt (0 for a legacy row that predates the field).
  createdAt: number;
  // The moment this todo was last checked, as epoch milliseconds, or null if it has never
  // been checked or was unchecked again since. Cleared back to null on uncheck — it tracks
  // the CURRENT completion, not a history of past ones. Powers the today-box/priority-box
  // rule that a just-completed todo stays visible (crossed out) through the rest of the day
  // it was finished, then drops off at the next midnight (see completedToday in plans.ts).
  completedAt: number | null;
  // This todo's rank in the priority-box, or null if it isn't ranked. Set by dragging the
  // todo onto the priority-box (a fractional sort key among ranked todos, same `between()`
  // scheme as a node's position) and cleared back to null by dragging it back out. Lower
  // sorts first — rank 1 outranks rank 2. Cross-plan: unlike planID, a todo's own priority
  // is read directly (no walking to a root) — a subtree does not inherit its ancestor's rank.
  priority: number | null;
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
  // The moment the plan was born, as epoch milliseconds. Set at creation; the pill formats it
  // into a creation time/date (a time today, "…yesterday", or "Jul 3" older — see formatCreatedAt).
  // 0 means unknown (a plan that predates the field), and the readout is then omitted.
  createdAt: number;
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
