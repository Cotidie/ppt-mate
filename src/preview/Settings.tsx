// Settings modal: a centered dialog with a left tab list and two panes. "Design"
// surfaces theme.json (the design system) as editable tokens; each field commits
// one dotted path to /api/theme/edit, whose write triggers Vite HMR (a full reload
// that re-renders the preview with the new tokens). "Model" shows the signed-in
// account, configured model, and rolling usage, read from /api/account + /api/usage.

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

// One token write. After the server rewrites theme.json, HMR reloads the page, so
// there's no client state to update here.
async function commitTheme(path: string, value: unknown): Promise<void> {
  await fetch("/api/theme/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, value }),
  }).catch(() => {});
}

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

// stopPropagation keeps the app's global ArrowLeft/Right slide-nav from firing
// while a field has focus; Enter commits and blurs.

function NumberField({ path, value }: { path: string; value: number }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = Number(draft.trim());
    if (isFinite(parsed) && parsed !== value) commitTheme(path, parsed);
  };
  return (
    <input
      type="number"
      className="set-input set-num"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function TextField({ path, value }: { path: string; value: string }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) commitTheme(path, trimmed);
  };
  return (
    <input
      type="text"
      className="set-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// A swatch (native color input, commits on release) paired with a hex text input
// (commits on blur/Enter if it's a valid #RRGGBB). Both share one draft.
function ColorField({ path, value }: { path: string; value: string }) {
  const [draft, setDraft] = useState(value);
  const commitHex = (hex: string) => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex) && hex !== value) commitTheme(path, hex);
  };
  return (
    <span className="set-color">
      <input
        type="color"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commitTheme(path, e.target.value);
        }}
      />
      <input
        type="text"
        className="set-input set-hex"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commitHex(draft)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            commitHex(draft);
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

function DesignPane() {
  return (
    <div>
      <div className="set-group">
        <div className="set-group-title">Colors</div>
        {Object.entries(theme.colors).map(([key, val]) => (
          <div className="set-row" key={key}>
            <span className="set-label">{key}</span>
            <ColorField path={`colors.${key}`} value={val} />
          </div>
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Fonts</div>
        {(Object.entries(theme.fonts) as [string, string][]).map(([key, val]) => (
          <div className="set-row" key={key}>
            <span className="set-label">{key}</span>
            <TextField path={`fonts.${key}`} value={val} />
          </div>
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Type (pt)</div>
        {(Object.entries(theme.type) as [string, number][]).map(([key, val]) => (
          <div className="set-row" key={key}>
            <span className="set-label">{key}</span>
            <NumberField path={`type.${key}`} value={val} />
          </div>
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Margin (in)</div>
        {(Object.entries(theme.margin) as [string, number][]).map(([key, val]) => (
          <div className="set-row" key={key}>
            <span className="set-label">{key}</span>
            <NumberField path={`margin.${key}`} value={val} />
          </div>
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Layout</div>
        {(Object.entries(theme.layout) as [string, number][]).map(([key, val]) => (
          <div className="set-row" key={key}>
            <span className="set-label">{key}</span>
            <NumberField path={`layout.${key}`} value={val} />
          </div>
        ))}
      </div>

      <div className="set-group">
        <div className="set-group-title">Canvas</div>
        <div className="set-row">
          <span className="set-label">w</span>
          <span className="set-value">{theme.canvas.w}</span>
        </div>
        <div className="set-row">
          <span className="set-label">h</span>
          <span className="set-value">{theme.canvas.h}</span>
        </div>
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
  // Active tab persists across the HMR full-page reload that a theme edit triggers.
  const [tab, setTab] = useState<"design" | "model">(() =>
    localStorage.getItem("ppt.settingsTab") === "model" ? "model" : "design"
  );
  useEffect(() => {
    localStorage.setItem("ppt.settingsTab", tab);
  }, [tab]);

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
