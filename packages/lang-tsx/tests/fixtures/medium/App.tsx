/**
 * Top-level application surface for the medium fixture. Composes Card and
 * Modal, drives them with hooks, and demonstrates conditional rendering,
 * list mapping, fragments, and re-exports.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CompactCard, type CardVariant } from "./Card.js";
import { Modal, type ModalKind } from "./Modal.js";

export interface Item {
  id: string;
  title: string;
  description: string;
}

export interface AppProps {
  items: Item[];
  defaultVariant?: CardVariant;
}

const DEFAULT_VARIANT: CardVariant = "default";

/**
 * Application root. Lists items as cards and opens a modal on selection.
 */
export function App({ items, defaultVariant = DEFAULT_VARIANT }: AppProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variant, setVariant] = useState<CardVariant>(defaultVariant);
  const [modalKind, setModalKind] = useState<ModalKind>("alert");

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (selectedItem) {
      document.title = `Selected: ${selectedItem.title}`;
    }
  }, [selectedItem]);

  const handleSelect = (id: string) => setSelectedId(id);
  const handleClose = () => setSelectedId(null);

  return (
    <Fragment>
      <header className="app__header">
        <h1>Catalog</h1>
        <select value={variant} onChange={(event) => setVariant(event.target.value as CardVariant)}>
          <option value="default">Default</option>
          <option value="compact">Compact</option>
          <option value="outlined">Outlined</option>
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
        onClose={handleClose}
      >
        <p>{selectedItem?.description}</p>
        <p>Modal mode: {modalKind}</p>
        <button type="button" onClick={() => setModalKind("confirm")}>Confirm mode</button>
      </Modal>
    </Fragment>
  );
}

export { Card, CompactCard } from "./Card.js";
export { Modal } from "./Modal.js";
export default App;
