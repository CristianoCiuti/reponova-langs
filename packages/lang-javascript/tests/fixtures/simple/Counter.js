/**
 * Simple counter module used as a smoke fixture for the
 * `@reponova/lang-javascript` extractor.
 *
 * Exercises:
 *  - ESM imports (named)
 *  - top-level function declarations
 *  - top-level arrow-function constants (treated as functions)
 *  - default export of a function declaration
 *  - named export of a constant
 *  - JSDoc on each declaration
 */
import { EventEmitter } from "node:events";

/**
 * Builds a counter event emitter pre-seeded with `initial` and bumping
 * by `step` on each `tick` call.
 */
export function createCounter(initial = 0, step = 1) {
  const emitter = new EventEmitter();
  let count = initial;

  const tick = () => {
    count += step;
    emitter.emit("change", count);
    return count;
  };

  const reset = () => {
    count = initial;
    emitter.emit("change", count);
  };

  return { emitter, tick, reset, get value() { return count; } };
}

/** Default step shared across counter instances. */
export const DEFAULT_STEP = 1;

/**
 * Convenience wrapper that creates a counter and returns its `tick`.
 */
export const makeTicker = (step = DEFAULT_STEP) => {
  const { tick } = createCounter(0, step);
  return tick;
};

export default createCounter;
