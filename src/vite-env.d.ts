/// <reference types="vite/client" />

import type { MockFeatureFlagger } from "./feature-flagger/mockFeatureFlagger";

declare global {
  interface Window {
    __TAB_PANE_IMPLEMENTATION__?: unknown;
    featureFlagger: MockFeatureFlagger;
  }
}
