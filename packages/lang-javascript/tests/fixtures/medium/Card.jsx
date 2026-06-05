/**
 * Reusable card component family for the medium-complexity fixture.
 * Exercises JSX (.jsx) with the tree-sitter-javascript grammar.
 */
import { Fragment } from "react";

/**
 * Card body. Wraps arbitrary children with a consistent header layout.
 */
export function Card({ title, subtitle, children, onSelect, id, className }) {
  return (
    <article className={`card ${className ?? ""}`.trim()} data-id={id}>
      <header className="card__header">
        <h3>{title}</h3>
        {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
      </header>
      <div className="card__body">{children}</div>
      {onSelect ? (
        <footer className="card__footer">
          <button type="button" onClick={() => onSelect(id)}>Select</button>
        </footer>
      ) : null}
    </article>
  );
}

/** Slim variant of {@link Card} with no footer. */
export function CompactCard({ title, children, id }) {
  return (
    <Card title={title} id={id}>
      <Fragment>{children}</Fragment>
    </Card>
  );
}

export const CARD_VARIANTS = ["default", "compact", "outlined"];
