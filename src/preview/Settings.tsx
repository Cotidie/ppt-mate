// Settings modal: a centered dialog with a left tab list and two panes. "Design"
// displays theme.json (the design system) as read-only key/value pairs. "Model"
// shows the signed-in account, configured model, and rolling usage, read from
// /api/account + /api/usage.

import { useEffect, useState } from "react";
import { theme } from "../theme/theme";

type Account = {
  loggedIn?: boolean;
  email?: string;
  authMethod?: string;
  subscriptionType?: string;
  orgName?: string;
  model?: string;
};
type Win = { utilization: number; resetsAt: string };
type Usage = { available: boolean; fiveHour?: Win | null; sevenDay?: Win | null };

// Time until an ISO reset stamp, e.g. "5d 19h" or "3h 10m".
function fmtRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!ms || ms <= 0) return "now";
  const totalMin = Math.round(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hrs = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  return days > 0 ? `${days}d ${hrs}h` : `${hrs}h ${mins}m`;
}

// Read-only value row. Numbers/strings render plain; colors get a swatch + hex.
function Row({ label, value, color }: { label: string; value: string | number; color?: boolean }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      {color ? (
        <span className="set-color">
          <span className="set-swatch" style={{ background: String(value) }} />
          <span className="set-value">{value}</span>
        </span>
      ) : (
        <span className="set-value">{value}</span>
      )}
    </div>
  );
}

// Design pane is read-only: it displays theme.json (the design system) as
// formatted key/value pairs. Editing is intentionally not wired up yet.
function DesignPane() {
  return (
    <div>
      <div className="set-group">
        <div className="set-group-title">Colors</div>
        {Object.entries(theme.colors).map(([key, val]) => (
          <Row key={key} label={key} value={val} color />
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Fonts</div>
        {Object.entries(theme.fonts).map(([key, val]) => (
          <Row key={key} label={key} value={val} />
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Type (pt)</div>
        {Object.entries(theme.type).map(([key, val]) => (
          <Row key={key} label={key} value={val} />
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Margin (in)</div>
        {Object.entries(theme.margin).map(([key, val]) => (
          <Row key={key} label={key} value={val} />
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Layout</div>
        {Object.entries(theme.layout).map(([key, val]) => (
          <Row key={key} label={key} value={val} />
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Canvas</div>
        <Row label="w" value={theme.canvas.w} />
        <Row label="h" value={theme.canvas.h} />
        <div className="set-note">Fixed 16:9</div>
      </div>
    </div>
  );
}

function ModelPane() {
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/account").then((r) => (r.ok ? r.json() : null)).then((a) => a && setAccount(a)).catch(() => {});
    fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((u) => u && setUsage(u)).catch(() => {});
  }, []);

  const winLabel = (win: Win | null | undefined): string =>
    win ? `${Math.round(win.utilization)}% · resets in ${fmtRemaining(win.resetsAt)}` : "—";

  return (
    <div>
      <div className="set-group">
        <div className="set-group-title">Account</div>
        <div className="set-row">
          <span className="set-label">Email</span>
          <span className="set-value">{account?.email ?? "—"}</span>
        </div>
        <div className="set-row">
          <span className="set-label">Plan</span>
          {account?.subscriptionType ? (
            <span className="cp-badge">{account.subscriptionType}</span>
          ) : (
            <span className="set-value">—</span>
          )}
        </div>
        <div className="set-row">
          <span className="set-label">Auth method</span>
          <span className="set-value">{account?.authMethod ?? "—"}</span>
        </div>
        <div className="set-row">
          <span className="set-label">Organization</span>
          <span className="set-value">{account?.orgName ?? "—"}</span>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">Model</div>
        <div className="set-row">
          <span className="set-label">Model</span>
          <span className="set-value">{account?.model ?? "—"}</span>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">Subscription usage</div>
        <div className="set-row">
          <span className="set-label">5-hour</span>
          <span className="set-value">{winLabel(usage?.fiveHour)}</span>
        </div>
        <div className="set-row">
          <span className="set-label">7-day</span>
          <span className="set-value">{winLabel(usage?.sevenDay)}</span>
        </div>
      </div>
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"design" | "model">("design");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <span>Settings</span>
          <button className="settings-close" aria-label="Close settings" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-modal-body">
          <nav className="settings-tabs">
            <button
              className={tab === "design" ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab("design")}
            >
              Design
            </button>
            <button
              className={tab === "model" ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab("model")}
            >
              Model
            </button>
          </nav>
          <div className="settings-content">{tab === "design" ? <DesignPane /> : <ModelPane />}</div>
        </div>
      </div>
    </div>
  );
}
