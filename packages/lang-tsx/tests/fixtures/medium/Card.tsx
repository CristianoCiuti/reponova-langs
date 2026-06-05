/**
 * Reusable card component family for the medium-complexity fixture.
 */
import { type ReactNode } from "react";

export interface CardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onSelect?: (id: string) => void;
  id: string;
  className?: string;
}

/**
 * Card body. Wraps arbitrary children with a consistent header layout.
 */
export function Card({ title, subtitle, children, onSelect, id, className }: CardProps) {
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
export function CompactCard({ title, children, id }: Pick<CardProps, "title" | "children" | "id">) {
  return (
    <Card title={title} id={id}>
      {children}
    </Card>
  );
}

export const CARD_VARIANTS = ["default", "compact", "outlined"] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];
