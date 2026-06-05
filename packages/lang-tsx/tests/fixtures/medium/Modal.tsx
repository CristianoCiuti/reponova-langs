/**
 * Class-based modal dialog for the medium fixture. Exercises class
 * components with state, lifecycle, generics, abstract base class,
 * accessibility modifiers (public / private / readonly), and decorators.
 */
import { Component, type ReactNode, type KeyboardEvent } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: ReactNode;
}

interface ModalState {
  hasFocus: boolean;
}

/** Base for any dialog-like overlay. */
export abstract class Overlay<P = unknown, S = unknown> extends Component<P, S> {
  protected readonly id: string;

  constructor(props: P) {
    super(props);
    this.id = `overlay-${Math.random().toString(36).slice(2, 8)}`;
  }

  abstract dismiss(): void;
}

function loggable<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  const name = String(context.name);
  return function (this: This, ...args: Args): Return {
    console.debug(`[Modal] -> ${name}`);
    return target.call(this, ...args);
  };
}

/** Concrete modal. Renders a dialog with a backdrop and close button. */
export class Modal extends Overlay<ModalProps, ModalState> {
  public static readonly Z_INDEX = 1000;
  private rootRef: HTMLDivElement | null = null;

  constructor(props: ModalProps) {
    super(props);
    this.state = { hasFocus: false };
  }

  componentDidMount(): void {
    if (this.props.open) {
      this.rootRef?.focus();
    }
  }

  componentDidUpdate(prevProps: ModalProps): void {
    if (!prevProps.open && this.props.open) {
      this.rootRef?.focus();
      this.setState({ hasFocus: true });
    }
  }

  @loggable
  dismiss(): void {
    this.props.onClose();
  }

  private handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      this.dismiss();
    }
  };

  render(): ReactNode {
    if (!this.props.open) {
      return null;
    }
    return (
      <div
        ref={(el) => {
          this.rootRef = el;
        }}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${this.id}-title`}
        tabIndex={-1}
        onKeyDown={this.handleKeyDown}
      >
        <div className="modal__backdrop" onClick={this.dismiss} />
        <section className="modal__content">
          <header>
            <h2 id={`${this.id}-title`}>{this.props.title}</h2>
            <button type="button" onClick={this.dismiss}>×</button>
          </header>
          <div className="modal__body">{this.props.children}</div>
        </section>
      </div>
    );
  }
}

export type ModalKind = "alert" | "confirm" | "prompt";
