import brandBoxUrl from "./components/brand-box/BrandBox.js?url";
import colorRangeUrl from "./components/color-range/ColorRange.js?url";
import tabPaneExtraUrl from "./components/tab-pane/TabPane.Extra.js?url";
import tabPaneUrl from "./components/tab-pane/TabPane.js?url";
import mainUrl from "./main.js?url";

const scriptSources: readonly string[] = [
  "https://cdn.jsdelivr.net/gh/akaIDIOT/MooTools-ColorRange@369437111704df7aeaf84a29e5a0ecc2733bbb53/Demo/mootools-core-1.4.2.js",
  "https://cdn.jsdelivr.net/gh/akaIDIOT/MooTools-ColorRange@369437111704df7aeaf84a29e5a0ecc2733bbb53/Demo/mootools-more-1.4.0.1.js",
  tabPaneUrl,
  tabPaneExtraUrl,
  brandBoxUrl,
  colorRangeUrl,
  mainUrl,
];

function loadClassicScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = false;
    script.src = source;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Could not load legacy script: ${source}`)),
      { once: true },
    );
    document.head.append(script);
  });
}

try {
  for (const source of scriptSources) {
    await loadClassicScript(source);
  }
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown script-loading error.";
  const alert = document.createElement("p");
  alert.className = "load-error";
  alert.role = "alert";
  alert.textContent = `${message} Check your network connection and reload.`;
  document.body.prepend(alert);
}
