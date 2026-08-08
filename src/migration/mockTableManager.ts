const REACT_TAB_PANE_FLAG = "react-tab-pane";

export const mockTableManager = {
  isEnabled(flagName: string): boolean {
    return (
      flagName === REACT_TAB_PANE_FLAG &&
      new URLSearchParams(window.location.search).get("tab-pane") === "react"
    );
  },
};

export type MockTableManager = typeof mockTableManager;
