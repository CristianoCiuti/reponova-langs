/**
 * Top-level application surface for the medium fixture. Composes Card and
 * Modal, drives them with hooks, and demonstrates conditional rendering,
 * list mapping, fragments, and re-exports — all in JavaScript+JSX (no
 * TypeScript types).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CompactCard, CARD_VARIANTS } from "./Card.jsx";
import { Modal } from "./Modal.jsx";

const DEFAULT_VARIANT = "default";

/**
 * Application root. Lists items as cards and opens a modal on selection.
 */
export function App({ items, defaultVariant = DEFAULT_VARIANT }) {
  const [selectedId, setSelectedId] = useState(null);
  const [variant, setVariant] = useState(defaultVariant);
  const [modalKind, setModalKind] = useState("alert");

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (selectedItem) {
      document.title = `Selected: ${selectedItem.title}`;
    }
  }, [selectedItem]);

  const handleSelect = (id) => setSelectedId(id);
  const handleClose = () => setSelectedId(null);

  return (
    <Fragment>
      <header className="app__header">
        <h1>Catalog</h1>
        <select value={variant} onChange={(event) => setVariant(event.target.value)}>
          {CARD_VARIANTS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </header>
      <main>
        {items.length === 0 ? (
          <p>No items.</p>
        ) : (
          items.map((item) => {
            if (variant === "compact") {
              return (
                <CompactCard key={item.id} id={item.id} title={item.title}>
                  {item.description}
                </CompactCard>
              );
            }
            return (
              <Card
                key={item.id}
                id={item.id}
                title={item.title}
                subtitle={variant}
                onSelect={handleSelect}
              >
                {item.description}
              </Card>
            );
          })
        )}
      </main>
      <Modal
        open={selectedItem !== null}
        title={selectedItem?.title ?? ""}
        kind={modalKind}
        onClose={handleClose}
      >
        <p>{selectedItem?.description}</p>
        <p>Modal mode: {modalKind}</p>
        <button type="button" onClick={() => setModalKind("confirm")}>Confirm mode</button>
      </Modal>
    </Fragment>
  );
}

export { Card, CompactCard } from "./Card.jsx";
export { Modal } from "./Modal.jsx";
export default App;
