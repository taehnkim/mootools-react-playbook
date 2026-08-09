import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./global.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("React root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <main className="site-shell">
      <p className="eyebrow">React migration sandbox</p>
      <h1>No components migrated yet.</h1>
      <p className="lede">
        Add each React replacement here as its MooTools migration is ready.
      </p>
    </main>
  </StrictMode>,
);
