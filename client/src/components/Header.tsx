interface HeaderProps {
  activeTab: "capture" | "recall";
  onTabChange: (tab: "capture" | "recall") => void;
  statusText?: string;
}

export function Header({ activeTab, onTabChange, statusText = "Ready" }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-name">loci</span>
        <span className="brand-sub">external memory</span>
      </div>

      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "capture" ? "active" : ""}`}
          onClick={() => onTabChange("capture")}
        >
          Capture
        </button>
        <button
          className={`tab-btn ${activeTab === "recall" ? "active" : ""}`}
          onClick={() => onTabChange("recall")}
        >
          Recall
        </button>
      </nav>

      <div className="system-status">
        <span className="status-dot" />
        <span className="status-label">{statusText}</span>
      </div>
    </header>
  );
}
