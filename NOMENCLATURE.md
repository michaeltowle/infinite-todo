AREA: UI

Note: In this area, nomenclature is given as css classes, but wherever these words are used, this is what they refer to.

- #todo-container : the big center column, where the todos are
- sidebar.double-sidebar#left-sidebar
- sidebar.double-sidebar#right-sidebar
- sidebar.mono-sidebar#mono-sidebar
- sidebar-box.pill-container.info-box
- pill.info-pill
- todo-row
- todo-row.todo-checked
- todo-row.data-checked
- zero-depth-node.todo-row
- positive-depth-node.todo-row
- sidebar-box.pill-container.plan-box
- pill.plan.plan-over : drag-hover state
- pill.plan.plan-active : plan currently in view and editable
- pill.plan.plan-rule-above
- pill.plan.plan-rule-below

SUBAREA: UI Pills

INFO-PILLS

1. #deployed-timestamp
2. #on-branch-branchname

AREA: "TODO" terminology

- "todo" : a single row of text with a checkbox and possibly other attributes, such as tags. should always be spelled without a hyphen, whether in code or css. casing: "Todo."
- "checked"/"unchecked" : our preferred terms for the boolean todo-checkbox value. do not use "done", "not done", "completed", etc.
- keyboardText
- treePlacement : parent_id plus position for updating node placement
- zdn (zero-depth node) : todos with zero indent
- pdn (positive-depth node) : todos with indent > 0 (i.e. todos with at least one parent)

AREA: Persistence

- create
- edit
- delete
- outbox : ordered, retrying outbox solves the issue of an edit arriving at the DO before the create for the same todo-node

AREA: plans

- "plan"
- uncheckedTodoCount : displayed with plan name as secondary text if and only if nonzero, in the form e.g. "3x" for 3 todos.

AREA: OptParse

The general idea here is to provide an extremely low-friction method of imbuing todo objects with key-value information.

The parse function takes the keyboardText, i.e. the raw user input, then loops the list of predefined valueTag regex patterns. Matches are extracted and inserted into a key-value object.
