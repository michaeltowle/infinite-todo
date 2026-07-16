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
- sidebar-box.pill-container.bucket-box
- pill.bucket.bucket-over : drag-hover state
- pill.bucket.bucket-active : bucket currently in view and editable
- pill.bucket.bucket-rule-above
- pill.bucket.bucket-rule-below

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

AREA: Buckets

- "bucket"
- hideUntil : the day a todo slides back into "today" if a YYYY-MM-DD date. Else, a special bucket ("someday", "big-ticket"), or unbucketed if null.
- uncheckedTodoCount : displayed with bucket name as secondary text if and only if nonzero, in the form e.g. "3x" for 3 todos.
- cumulativeTimeEstUnchecked : the cumulative time of all "time-est" values of unchecked todos. displayed with bucket name as secondary text if and only if nonzero. format purely as hh:mm, with no zero-padding of hours.

AREA: OptParse

The general idea here is to provide an extremely low-friction method of imbuing todo objects with key-value information.

The parse function takes the keyboardText, i.e. the raw user input, then loops the list of predefined valueTag regex patterns. Matches are extracted and inserted into a key-value, itself part of the todo object, called getKey.

- optparse : Our specialized system of parsing a todo's keyboardText. Outputs include a) displayText, b) various key-value pairs applicable to the todo, such as the user's estimate of the task's time-to-completion (time-est)
- valueTags : any string of non-whitespace chars with a leading "#" in the keyboardText.
- keyboardText : the raw string text the user sends to the text field, which may optionally contain parseable content to be translated into key-value pairs
  - Example: "take the dog for a walk #30min"
- visibleDisplayText : remaining visible text after parse.
  - Continued example: "take the dog for a walk"
- time-est : estimated time to completion, expressed e.g. "1hr", "2hr", "30min". There will be no space
  - Continued example: {"time-est": integer minutes }
- keyValue
- getKey : dictionary of key-value pairs. each todo has one getKey, even if it is empty.
