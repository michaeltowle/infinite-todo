AREA: UI

Note: In this area, nomenclature is given as css classes, but wherever these words are used, this is what they refer to.

- #todo-container : the big center column, where the todos are
- sidebar.double-sidebar#left-sidebar
- sidebar.double-sidebar#right-sidebar
- sidebar.mono-sidebar#mono-sidebar
- sidebar-box.pill-container.action-box
- sidebar-box.pill-container.info-box
- pill.action-pill
- pill.info-pill
- todo-row
- todo-row.todo-checked
- todo-row.data-checked
- sidebar-box.pill-container.bucket-box
- pill.bucket
- pill.bucket.bucket-over  : drag-hover state

SUBAREA: UI Pills

ACTION-PILLS

1. #copy-as-json-raw-array
2. #copy-as-json-nested-object-tree

INFO-PILLS

1. #deployed-timestamp
2. #on-branch-branchname
3. #page-edit-timestamp
4. #commit-timestamp

AREA: "TODO" terminology

- "todo" : a single row of text with a checkbox and possibly other attributes, such as tags. should always be spelled without a hyphen, whether in code or css. casing: "Todo."
- "checked"/"unchecked" : our preferred terms for the boolean todo-checkbox value. do not use "done", "not done", "completed", etc.
- keyboardText
- treePlacement - parent_id plus position for updating node placement

AREA: Persistence
- create
- edit
- delete
- outbox - ordered, retrying outbox solves the issue of an edit arriving at the DO before the create for the same todo-node


AREA: Buckets
- "bucket" : a drop-target day in the bucket-box. Drop a todo on one and it leaves
  #todo-container until that morning, taking its subtree with it. Click a bucket to
  tip its contents back onto the board.
- hideUntil - the day a todo comes back. YYYY-MM-DD, "someday", or null.