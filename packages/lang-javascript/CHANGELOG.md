# @reponova/lang-javascript

## 0.2.0

### Minor Changes

- ebf8067: Add `@reponova/lang-javascript`, the JavaScript language plugin (handles `.js`, `.mjs`, `.cjs`, and `.jsx` via the `tree-sitter-javascript` WASM grammar v0.25.0). Symbol-extraction and outline logic are shared with `@reponova/lang-typescript` and `@reponova/lang-tsx` through the workspace-internal `@reponova/lang-typescript-core` package, so a graph that mixes JS / TS / JSX / TSX files emits a homogeneous `FileExtraction` shape.

  Five extractor improvements landed in `lang-typescript-core` to make a single core handle the JS grammar in addition to the TS grammar; both `lang-typescript` and `lang-tsx` benefit transparently:

  - **CommonJS `require()` imports**: `var x = require('mod')`, `const { y } = require('mod')`, `const path = require('node:path')` are now recognised as `Import` entries (treated as a default import for the binding-name form, named imports for object-pattern destructuring), so a CJS-only module like Express's `lib/` produces an `imports` list indistinguishable from an ESM equivalent.
  - **JS-grammar `class_heritage`**: tree-sitter-javascript exposes the heritage expression directly as a child of `class_heritage` (no `extends_clause` wrapper, unlike tree-sitter-typescript). The shared extractor now accepts both shapes, so `class Modal extends Component { … }` populates `bases` correctly in both grammars.
  - **`generator_function_declaration`**: tree-sitter-javascript emits a distinct node kind for `function* gen()` (vs tree-sitter-typescript which folds it into `function_declaration` + `*` token). The shared extractor now matches both and surfaces the `generator` modifier from the node type itself.
  - **JS-grammar `field_definition`**: tree-sitter-javascript exposes class fields as `field_definition` (vs tree-sitter-typescript's `public_field_definition`) with the field name under the `property` field rather than `name`. The shared `extractClassField` accepts both shapes plus a property-identifier fallback.
  - **`new X()` as a call edge**: `new EventEmitter()`, `new HttpError(404)`, … are now recorded as calls to the constructor name, mirroring how `call_expression` to a factory function would surface. Applies uniformly to both grammars.
