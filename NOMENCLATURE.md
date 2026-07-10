AREA: UI

Note: In this area, nomenclature is given as css classes, but wherever these words are used, this is what they refer to.

- #todo-container : the big center column, where the todos are
- sidebar.double-sidebar#left-sidebar
- sidebar.double-sidebar#right-sidebar
- sidebar.mono-sidebar#mono-sidebar
- pill-container.action-box
- pill-container.info-box
- pill.action-pill
- pill.info-pill
- todo-row
- todo-row.todo-checkbox
- todo-row.data-checked

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
