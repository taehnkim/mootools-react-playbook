import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TabPaneDemo } from "./components/tab-pane/TabPaneDemo";
import "./global.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("React root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <TabPaneDemo />
  </StrictMode>,
);
