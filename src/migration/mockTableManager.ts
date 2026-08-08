const TAB_PANE_SELECTION_KEY = "TabPane";
const LEGACY_TAB_PANE_IMPLEMENTATION = "legacy-TabPane";
const REACT_TAB_PANE_IMPLEMENTATION = "react-TabPane";

type TabPaneImplementation =
  | typeof LEGACY_TAB_PANE_IMPLEMENTATION
  | typeof REACT_TAB_PANE_IMPLEMENTATION;

export type MockTableManager = {
  get(selectionKey: string): TabPaneImplementation | undefined;
};

export function createMockTableManager(
  implementation?: unknown,
): MockTableManager {
  const tabPaneImplementation =
    implementation === REACT_TAB_PANE_IMPLEMENTATION
      ? REACT_TAB_PANE_IMPLEMENTATION
      : LEGACY_TAB_PANE_IMPLEMENTATION;

  return {
    get(selectionKey) {
      return selectionKey === TAB_PANE_SELECTION_KEY
        ? tabPaneImplementation
        : undefined;
    },
  };
}
