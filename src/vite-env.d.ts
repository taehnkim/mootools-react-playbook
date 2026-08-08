/// <reference types="vite/client" />

import type { TabPaneHandle } from "./components/tab-pane/TabPane";
import type { mountReactTabPane } from "./components/tab-pane/mountTabPane";
import type { MockTableManager } from "./migration/mockTableManager";

type ReactSandbox = {
  fixtureId: string;
  tabPane: TabPaneHandle;
};

declare global {
  interface Window {
    ReactSandbox?: ReactSandbox;
    __MOOTOOLS_MIGRATION_FIXTURE__?: unknown;
    __MOOTOOLS_MIGRATION_FIXTURE_ID__?: unknown;
    mountReactTabPane: typeof mountReactTabPane;
    tableManager: MockTableManager;
  }
}
