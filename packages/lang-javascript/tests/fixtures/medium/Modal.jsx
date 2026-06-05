/**
 * Modal class component used to exercise prototype-based class semantics
 * with JSX in the `tree-sitter-javascript` grammar.
 */
import { Component } from "react";

/**
 * Class-based modal with an internal mounted-state and a focus-restore
 * hook. Demonstrates `class … extends React.Component` plus JSX in render.
 */
export class Modal extends Component {
  static defaultProps = {
    kind: "alert",
  };

  constructor(props) {
    super(props);
    this.state = { mounted: false };
    this.previousActive = null;
    this.handleClose = this.handleClose.bind(this);
  }

  componentDidMount() {
    this.previousActive = document.activeElement;
    this.setState({ mounted: true });
  }

  componentWillUnmount() {
    if (this.previousActive && this.previousActive.focus) {
      this.previousActive.focus();
    }
  }

  /** Bound onClose handler. */
  handleClose() {
    if (this.props.onClose) this.props.onClose();
  }

  render() {
    const { open, title, kind, children } = this.props;
    if (!open) return null;
    return (
      <div className="modal" role="dialog" aria-modal="true" data-kind={kind}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" onClick={this.handleClose}>Close</button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    );
  }
}

/** Allowed kinds for the Modal `kind` prop. */
export const MODAL_KINDS = ["alert", "confirm", "prompt"];
