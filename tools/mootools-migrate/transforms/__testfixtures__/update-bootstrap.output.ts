import tabPaneUrl from "./components/tab-pane/TabPane.js?url";
import mainUrl from "./main.js?url";

import mountAdapterUrl from "./adapters/mount-tab-pane.js?url";

const scriptSources = [
  tabPaneUrl,
  mountAdapterUrl,
  // The application starts last.
  mainUrl,
];
