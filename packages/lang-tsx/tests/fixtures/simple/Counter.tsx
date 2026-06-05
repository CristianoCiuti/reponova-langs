/**
 * Simple counter component used as a smoke fixture for the
 * `@reponova/lang-tsx` extractor.
 */
import { useState, useCallback } from "react";

export interface CounterProps {
  initial?: number;
  step?: number;
  label: string;
}

/**
 * Functional component returning JSX. Exercises:
 * - typed props with optional fields
 * - hook calls (useState, useCallback)
 * - JSX with attributes, expressions, fragments
 * - inline event handlers
 */
export function Counter({ initial = 0, step = 1, label }: CounterProps) {
  const [count, setCount] = useState(initial);

  const increment = useCallback(() => setCount(count + step), [count, step]);
  const decrement = useCallback(() => setCount(count - step), [count, step]);

  return (
    <section className="counter" aria-label={label}>
      <h2>{label}</h2>
      <span data-testid="value">{count}</span>
      <div className="controls">
        <button type="button" onClick={increment}>+{step}</button>
        <button type="button" onClick={decrement}>-{step}</button>
      </div>
    </section>
  );
}

/** Default step shared across counter instances. */
export const DEFAULT_STEP = 1;

export default Counter;
