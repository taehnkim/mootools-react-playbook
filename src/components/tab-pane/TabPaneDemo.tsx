import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import "../../../styles.css";
import {
  TabPane,
  type TabPaneHandle,
  type TabPaneTab,
} from "./TabPane";

type ReactSandbox = {
  fixtureId: string;
  tabPane: TabPaneHandle;
};

declare global {
  interface Window {
    ReactSandbox?: ReactSandbox;
    __MOOTOOLS_MIGRATION_FIXTURE__?: unknown;
    __MOOTOOLS_MIGRATION_FIXTURE_ID__?: unknown;
  }
}

const DEFAULT_FIXTURE_ID = "default-tabs";

const DEFAULT_TABS: readonly TabPaneTab[] = [
  {
    id: "hello",
    label: "Hello",
    content: (
      <>
        <h3>Hello world</h3>
        <p>
          TabPane pairs each tab with content at the same index. It hides every
          panel except the selected one.
        </p>
      </>
    ),
    closable: true,
  },
  {
    id: "behavior",
    label: "Behavior",
    content: (
      <>
        <h3>Delegated events</h3>
        <p>
          One click listener on the container handles existing and new tabs.
          TabPane.Extra adds and closes matching tab-panel pairs.
        </p>
      </>
    ),
    closable: true,
  },
  {
    id: "migration-notes",
    label: "Migration notes",
    content: (
      <>
        <h3>A useful first migration</h3>
        <p>
          Preserve selection, add, close, and change events. Then add keyboard
          and accessibility behavior in the React version.
        </p>
      </>
    ),
    closable: true,
  },
];

export function TabPaneDemo() {
  const fixtureId = readFixtureId();
  const initialTabs = readFixtureTabs() ?? DEFAULT_TABS;
  const handleRef = useRef<TabPaneHandle>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const generatedTabCountRef = useRef(0);
  const [status, setStatus] = useState("Showing tab 1.");
  const [title, setTitle] = useState("New tab");
  const [content, setContent] = useState("Added by TabPane.Extra.");

  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) {
      return;
    }
    const updateStatus = (index: number) => {
      setStatus(`Showing tab ${index + 1}.`);
    };
    handle.addEvent("change", updateStatus);
    window.ReactSandbox = { fixtureId, tabPane: handle };
    return () => {
      handle.removeEvent("change", updateStatus);
      if (window.ReactSandbox?.tabPane === handle) {
        delete window.ReactSandbox;
      }
    };
  }, [fixtureId]);

  function addTab(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (normalizedTitle === "" || normalizedContent === "") {
      setStatus("Enter both a tab name and tab content.");
      return;
    }

    const handle = handleRef.current;
    if (handle === null) {
      return;
    }
    const id = uniqueTabId(normalizedTitle, generatedTabCountRef.current);
    generatedTabCountRef.current += 1;
    handle.add(
      {
        id,
        label: normalizedTitle,
        content: (
          <>
            <h3>{normalizedTitle}</h3>
            <p>{normalizedContent}</p>
          </>
        ),
        closable: true,
      },
      true,
    );
    setTitle("");
    setContent("");
    titleInputRef.current?.focus();
  }

  return (
    <div className="legacy-page">
      <header className="legacy-header">
        <div className="legacy-shell">
          <nav className="site-nav" aria-label="Sandbox pages">
            <strong>MooTools → React sandbox</strong>
            <a href="/">Legacy reference</a>
          </nav>
          <p className="eyebrow">React + TypeScript</p>
          <h1>Hello from the React TabPane.</h1>
          <p className="lede">
            This component uses the same fixture and browser scenarios as the
            MooTools reference.
          </p>
        </div>
      </header>

      <main className="legacy-shell component-stack">
        <article className="demo-card">
          <header className="demo-heading">
            <div>
              <p className="component-kicker">Migrated component</p>
              <h2>TabPane</h2>
            </div>
            <a href="/#tab-pane-demo">Open legacy reference</a>
          </header>
          <div className="demo-content">
            <TabPane
              initialSelectedId="hello"
              initialTabs={initialTabs}
              onMinimumTabClose={() => setStatus("Keep at least one tab open.")}
              ref={handleRef}
            />

            <form className="add-tab-form" onSubmit={addTab}>
              <label>
                New tab name
                <input
                  data-migration-control="new-tab-title"
                  name="title"
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  ref={titleInputRef}
                  type="text"
                  value={title}
                />
              </label>
              <label>
                New tab content
                <input
                  data-migration-control="new-tab-content"
                  name="content"
                  onChange={(event) => setContent(event.currentTarget.value)}
                  type="text"
                  value={content}
                />
              </label>
              <button data-migration-control="add-tab" type="submit">
                Add and open tab
              </button>
            </form>
            <p
              aria-live="polite"
              className="event-status"
              data-migration-control="tab-pane-status"
            >
              {status}
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}

function readFixtureId(): string {
  return typeof window.__MOOTOOLS_MIGRATION_FIXTURE_ID__ === "string"
    ? window.__MOOTOOLS_MIGRATION_FIXTURE_ID__
    : DEFAULT_FIXTURE_ID;
}

function readFixtureTabs(): TabPaneTab[] | null {
  const fixture = window.__MOOTOOLS_MIGRATION_FIXTURE__;
  if (typeof fixture !== "object" || fixture === null) {
    return null;
  }
  const tabs = Reflect.get(fixture, "tabs");
  if (!Array.isArray(tabs)) {
    return null;
  }

  const result: TabPaneTab[] = [];
  for (const value of tabs) {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const id = Reflect.get(value, "id");
    const label = Reflect.get(value, "label");
    const heading = Reflect.get(value, "contentHeading");
    const closable = Reflect.get(value, "closable");
    if (
      typeof id !== "string" ||
      typeof label !== "string" ||
      typeof heading !== "string" ||
      typeof closable !== "boolean"
    ) {
      return null;
    }
    result.push({
      id,
      label,
      content: fixtureContent(id, heading),
      closable,
    });
  }
  return result.length > 0 ? result : null;
}

function fixtureContent(id: string, heading: string): ReactNode {
  const body = DEFAULT_TABS.find((tab) => tab.id === id)?.content;
  if (body !== undefined) {
    return body;
  }
  return (
    <>
      <h3>{heading}</h3>
      <p>Migrated fixture content.</p>
    </>
  );
}

function uniqueTabId(title: string, count: number): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "new-tab";
  return count === 0 ? base : `${base}-${count + 1}`;
}
