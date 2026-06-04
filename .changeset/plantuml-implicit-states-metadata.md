---
"@reponova/lang-plantuml": minor
---

feat(lang-plantuml): implicit-state promotion + caption / header / footer metadata fallback

Closes the two remaining documented gaps in the PlantUML extractor:

- **Implicit-state promotion**: any bare identifier that appears as a transition endpoint and never receives an explicit declaration anywhere else in the file is now promoted to a `component` symbol decorated with `["state", "implicit"]`. A pure-transition state diagram such as
  ```plantuml
  [*] --> Draft
  Draft --> Submitted
  Submitted --> Approved
  ```
  used to produce zero symbols (you had to add standalone `state X` lines for each); it now produces three implicit-state symbols (`Draft`, `Submitted`, `Approved`).

  Promotion runs in a second pass AFTER the main loop, so a node that's declared explicitly later in the file (`state Submitted #green`) wins over an earlier transition mention and keeps the regular `["state"]` decorator without the `implicit` marker.

- **Metadata fallback for the file docstring**: the file-node docstring used to look at `title` only. It now falls back through the precedence chain `title` > `caption` > `header` > `footer`, so PlantUML files annotated with `caption`, `(center) header`, or `footer` produce a useful docstring instead of `undefined`. Both inline forms (`title Foo`) and multi-line block forms (`header\n  Foo\nendheader` / `footer\n…\nendfooter`) are recognised. The body of multi-line `header` / `footer` blocks is intentionally NOT parsed as PlantUML, so misleading content inside an annotation block (`Foo --> Bar` inside `header`) does NOT create spurious symbols or transitions.

Five new unit tests pin the new behaviour. The existing fixture-level test for `complex/order-state.puml` is updated to assert that `Empty`, `Cancelled`, `Delivered`, and `Closed` are now surfaced as implicit-state symbols.
