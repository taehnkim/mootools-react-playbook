import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export type TabPaneTab = {
  id: string;
  label: string;
  content: ReactNode;
  closable: boolean;
};

export type TabPaneEventName = "add" | "change" | "close";
export type TabPaneEventListener = (index: number) => void;

export type TabPaneHandle = {
  add(tab: TabPaneTab, showNow?: boolean, location?: number): void;
  addEvent(name: TabPaneEventName, listener: TabPaneEventListener): void;
  close(index: number): void;
  removeEvent(name: TabPaneEventName, listener: TabPaneEventListener): void;
  show(index: number): void;
};

type TabPaneProps = {
  closeOwner: "component" | "host";
  initialTabs: readonly TabPaneTab[];
  initialSelectedId: string;
  onMinimumTabClose(): void;
};

export const TabPane = forwardRef<TabPaneHandle, TabPaneProps>(
  function TabPane(
    { closeOwner, initialTabs, initialSelectedId, onMinimumTabClose },
    forwardedRef,
  ) {
    const [tabs, setTabs] = useState<TabPaneTab[]>([...initialTabs]);
    const [selectedId, setSelectedId] = useState(initialSelectedId);
    const tabsRef = useRef(tabs);
    const selectedIdRef = useRef(selectedId);
    const minimumTabCloseRef = useRef(onMinimumTabClose);
    const tabElementsRef = useRef(new Map<string, HTMLLIElement>());
    const listenersRef = useRef(
      new Map<TabPaneEventName, Set<TabPaneEventListener>>(),
    );

    tabsRef.current = tabs;
    selectedIdRef.current = selectedId;
    minimumTabCloseRef.current = onMinimumTabClose;

    function fireEvent(name: TabPaneEventName, index: number): void {
      for (const listener of listenersRef.current.get(name) ?? []) {
        listener(index);
      }
    }

    function selectIndex(index: number): void {
      const tab = tabsRef.current[index];
      if (tab === undefined) {
        return;
      }
      selectedIdRef.current = tab.id;
      setSelectedId(tab.id);
      fireEvent("change", index);
    }

    function closeIndex(index: number): void {
      const currentTabs = tabsRef.current;
      const closingTab = currentTabs[index];
      if (closingTab === undefined) {
        return;
      }
      if (currentTabs.length === 1) {
        minimumTabCloseRef.current();
        return;
      }

      const nextTabs = currentTabs.filter((tab) => tab.id !== closingTab.id);
      let nextSelectedId = selectedIdRef.current;
      if (closingTab.id === selectedIdRef.current) {
        nextSelectedId =
          nextTabs[Math.min(index, nextTabs.length - 1)]?.id ??
          nextTabs[0]?.id ??
          "";
      }

      tabsRef.current = nextTabs;
      selectedIdRef.current = nextSelectedId;
      setTabs(nextTabs);
      setSelectedId(nextSelectedId);
      fireEvent("close", index);
      const selectedIndex = nextTabs.findIndex(
        (tab) => tab.id === nextSelectedId,
      );
      fireEvent("change", selectedIndex);
      queueMicrotask(() => tabElementsRef.current.get(nextSelectedId)?.focus());
    }

    useImperativeHandle(
      forwardedRef,
      () => ({
        add(tab, showNow = false, location) {
          if (tabsRef.current.some((current) => current.id === tab.id)) {
            return;
          }
          const currentTabs = tabsRef.current;
          const index =
            location !== undefined &&
            Number.isInteger(location) &&
            location >= 0 &&
            location < currentTabs.length
              ? location
              : currentTabs.length;
          const nextTabs = [
            ...currentTabs.slice(0, index),
            tab,
            ...currentTabs.slice(index),
          ];
          tabsRef.current = nextTabs;
          setTabs(nextTabs);
          fireEvent("add", index);
          if (showNow) {
            selectedIdRef.current = tab.id;
            setSelectedId(tab.id);
            fireEvent("change", index);
          }
        },
        addEvent(name, listener) {
          const listeners =
            listenersRef.current.get(name) ??
            new Set<TabPaneEventListener>();
          listeners.add(listener);
          listenersRef.current.set(name, listeners);
        },
        close(index) {
          closeIndex(index);
        },
        removeEvent(name, listener) {
          listenersRef.current.get(name)?.delete(listener);
        },
        show(index) {
          selectIndex(index);
        },
      }),
      [],
    );

    function handleTabClick(
      event: ReactMouseEvent<HTMLLIElement>,
      index: number,
    ): void {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-close-tab]") !== null
      ) {
        return;
      }
      selectIndex(index);
    }

    function handleTabKeyDown(
      event: KeyboardEvent<HTMLLIElement>,
      index: number,
    ): void {
      if (event.target !== event.currentTarget) {
        return;
      }
      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
          nextIndex = (index - 1 + tabs.length) % tabs.length;
          break;
        case "ArrowRight":
          nextIndex = (index + 1) % tabs.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      selectIndex(nextIndex);
      const nextTab = tabsRef.current[nextIndex];
      if (nextTab !== undefined) {
        tabElementsRef.current.get(nextTab.id)?.focus();
      }
    }

    return (
      <>
        <ul className="tabs" role="tablist" aria-label="Migration example tabs">
          {tabs.map((tab, index) => {
            const active = tab.id === selectedId;
            return (
              <li
                aria-controls={`panel-${tab.id}`}
                aria-selected={active}
                className={active ? "tab active" : "tab"}
                data-tab-id={tab.id}
                id={`tab-${tab.id}`}
                key={tab.id}
                onClick={(event) => handleTabClick(event, index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(element) => {
                  if (element === null) {
                    tabElementsRef.current.delete(tab.id);
                  } else {
                    tabElementsRef.current.set(tab.id, element);
                  }
                }}
                role="tab"
                tabIndex={active ? 0 : -1}
              >
                <span>{tab.label}</span>
                {tab.closable ? (
                  <button
                    aria-label={`Close ${tab.label} tab`}
                    className="tab-close"
                    data-close-tab=""
                    onClick={
                      closeOwner === "component"
                        ? (event) => {
                            event.stopPropagation();
                            closeIndex(index);
                          }
                        : undefined
                    }
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {tabs.map((tab) => {
          const active = tab.id === selectedId;
          return (
            <section
              aria-labelledby={`tab-${tab.id}`}
              className="content"
              data-panel-id={tab.id}
              hidden={!active}
              id={`panel-${tab.id}`}
              key={tab.id}
              role="tabpanel"
              style={{ display: active ? "block" : "none" }}
              tabIndex={0}
            >
              {tab.content}
            </section>
          );
        })}
      </>
    );
  },
);
