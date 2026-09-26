export type TabPaneTab = {
  id: string;
  label: string;
  heading: string;
  body: string;
  closable: boolean;
};

export function TabPane({
  tabs,
  selectedId,
  onSelect,
}: {
  tabs: TabPaneTab[];
  selectedId: string | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div data-migration-component="tab-pane">
      <ul className="tabs" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedId;
          return (
            <li
              aria-selected={selected}
              className={selected ? "tab active" : "tab"}
              data-tab-id={tab.id}
              key={tab.id}
              onClick={() => onSelect(index)}
              role="tab"
            >
              <span>{tab.label}</span>
              {tab.closable && (
                <button
                  aria-label={`Close ${tab.label} tab`}
                  className="tab-close"
                  data-close-tab=""
                  type="button"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {tabs.map((tab) => (
        <section
          className="content"
          data-panel-id={tab.id}
          key={tab.id}
          role="tabpanel"
          style={{ display: tab.id === selectedId ? "block" : "none" }}
        >
          <h3>{tab.heading}</h3>
          <p>{tab.body}</p>
        </section>
      ))}
    </div>
  );
}
