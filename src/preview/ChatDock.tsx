import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { fetchEventSource, EventStreamContentType } from "@microsoft/fetch-event-source";
import { AgentContextBar } from "./AgentContextBar";
import { getPendingVisual, clearPendingVisual, getSlideCapturer } from "./agentContext";

type Role = "user" | "assistant" | "error";
type Message = { role: Role; text: string };

// Claude account info (from /api/account) + live session stats (from chat `meta`
// SSE frames). Shown in the dock's left panel.
type Account = {
  loggedIn?: boolean;
  email?: string;
  authMethod?: string;
  subscriptionType?: string;
  orgName?: string;
  model?: string;
};
// One `meta` SSE frame: model (once, on init) or context gauge (per result).
type MetaFrame = { model?: string; contextUsed?: number; contextWindow?: number };
// Accumulated session stats shown in the panel. contextUsed/Window are
// point-in-time (latest turn), not summed.
type Stats = { model?: string; contextUsed?: number; contextWindow?: number };

// 5h / 7d usage limits from /api/usage.
type Win = { utilization: number; resetsAt: string };
type ApiUsage = { available: boolean; fiveHour?: Win | null; sevenDay?: Win | null };

const HEIGHT_MIN = 140;
const HEIGHT_HIDE_AT = 60; // drag shorter than this and the dock snaps shut
const HEIGHT_KEY = "ppt.chatHeight";

// Bottom-docked chat that drives the local Claude Code CLI via /api/chat. The
// dev server holds one long-lived Claude process and keeps conversation state,
// so each turn is just a message in and a streamed reply out. "New chat" resets
// that process.
export function ChatDock() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const height = useChatHeight();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  // Who's signed in + plan; one-shot on mount (server caches it).
  useEffect(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => a && setAccount(a))
      .catch(() => {});
    refreshUsage();
  }, []);

  const refreshUsage = () => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((u: ApiUsage | null) => u && setUsage(u))
      .catch(() => {});
  };

  const send = async () => {
    const message = input.trim();
    if (!message || streaming) return;
    // Attach a pending Visual Selection crop, if any, to this turn (one-shot).
    const visual = getPendingVisual();
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }, { role: "assistant", text: "" }]);
    setStreaming(true);
    try {
      await streamReply(message, applyEvent, new AbortController().signal, visual?.dataUrl);
      if (visual) clearPendingVisual();
    } catch (err) {
      applyEvent({ kind: "error", text: String(err) });
    } finally {
      setStreaming(false);
      refreshUsage();
    }
  };

  // Ends the conversation: tells the server to kill its Claude process and wipes
  // the local transcript so the next message starts fresh.
  const newChat = async () => {
    setMenuOpen(false);
    if (streaming) return;
    await fetch("/api/chat/reset", { method: "POST" }).catch(() => {});
    setMessages([]);
    setStats((s) => ({ model: s.model })); // fresh session: context gauge resets
  };

  // Folds a parsed SSE event into the message list. Assistant text deltas append
  // to the in-flight (last) message; errors are pushed as their own line.
  const applyEvent = (ev: ChatEvent) => {
    if (ev.kind === "delta") appendToLast(setMessages, ev.text);
    else if (ev.kind === "error") setMessages((m) => [...m, { role: "error", text: ev.text }]);
    else if (ev.kind === "meta")
      setStats((prev) => ({
        model: ev.meta.model ?? prev.model,
        contextUsed: ev.meta.contextUsed ?? prev.contextUsed,
        contextWindow: ev.meta.contextWindow ?? prev.contextWindow,
      }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation(); // keep arrows from flipping slides while typing
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hidden = height.value === 0;

  return (
    <div
      className={"chat-dock" + (hidden ? " hidden" : "")}
      style={hidden ? undefined : ({ height: height.value } as CSSProperties)}
    >
      <div
        className={"chat-resizer" + (height.dragging ? " dragging" : "")}
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize — drag fully down to hide"
        onPointerDown={height.onDragStart}
      >
        <span className="resizer-grip resizer-grip-h" aria-hidden="true" />
      </div>
      {hidden ? null : (
        <div className="chat-body">
      <AccountPanel account={account} stats={stats} usage={usage} />
      <div className="chat-col">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={"chat-msg chat-" + m.role}>
            {m.text || (streaming && i === messages.length - 1 ? <TypingDots /> : "")}
          </div>
        ))}
      </div>
      <AgentContextBar />
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder="Ask Claude Code to edit slides, or anything…"
          value={input}
          disabled={streaming}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-send-group">
          <button className="chat-send" onClick={send} disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </button>
          <button
            className="chat-send-caret"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ▾
          </button>
          {menuOpen && (
            <>
              <div className="chat-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="chat-menu" role="menu">
                <button role="menuitem" onClick={newChat} disabled={messages.length === 0}>
                  New chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
        </div>
      )}
    </div>
  );
}

// Animated "Claude is thinking" indicator: three bouncing dots, shown in the
// in-flight assistant bubble until the first text delta arrives.
function TypingDots() {
  return (
    <span className="typing" role="status" aria-label="Claude is thinking">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

// Format a token count as e.g. "28K" or "1.0M".
function fmtTok(n: number): string {
  return n < 1_000_000 ? Math.round(n / 1000) + "K" : (n / 1_000_000).toFixed(1) + "M";
}

// Format remaining time until an ISO reset timestamp. Returns e.g. "5d 19h" or
// "3h 10m". Returns "" if the date is invalid or already past.
function fmtRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!ms || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hrs = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// A single usage bar: label on the left (e.g. "5h"), percentage + detail on the
// right, with a thin track/fill below. No bar or percentage rendered when data
// is missing. Orange fill at ≥ 90%.
function UsageGauge({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  return (
    <div className="cp-gauge">
      <div className="cp-gauge-head">
        <span className="cp-gauge-label">{label}</span>
        {pct != null ? (
          <>
            <span className="cp-gauge-pct">{Math.round(pct)}%</span>
            <span className="cp-gauge-detail">{detail}</span>
          </>
        ) : (
          <span className="cp-gauge-detail">—</span>
        )}
      </div>
      {pct != null && (
        <div className="cp-gauge-bar">
          <div className={"cp-gauge-fill" + (pct >= 90 ? " warn" : "")} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

// Left-rail panel inside the dock: Claude account, active model, and usage
// gauges (context window, 5h, 7d). Account comes from /api/account; model and
// context tokens from chat stream `meta` frames; 5h/7d from /api/usage.
function AccountPanel({ account, stats, usage }: { account: Account | null; stats: Stats; usage: ApiUsage | null }) {
  const model = stats.model ?? account?.model;
  const ctxPct = stats.contextUsed != null && stats.contextWindow
    ? stats.contextUsed / stats.contextWindow * 100
    : null;
  const ctxDetail = stats.contextUsed != null && stats.contextWindow
    ? `${fmtTok(stats.contextUsed)}/${fmtTok(stats.contextWindow)}`
    : "—";
  const fh = usage?.fiveHour;
  const sd = usage?.sevenDay;
  return (
    <aside className="chat-panel">
      <div className="cp-section">
        <div className="cp-head">
          <span className="cp-label">Account</span>
          {account?.subscriptionType && (
            <span className="cp-badge">{account.subscriptionType}</span>
          )}
        </div>
        <div className="cp-value" title={account?.email}>{account?.email ?? "…"}</div>
      </div>
      <div className="cp-section">
        <div className="cp-label">Model</div>
        <div className="cp-value" title={model}>{model ?? "…"}</div>
      </div>
      <div className="cp-section">
        <div className="cp-label">Usage</div>
        <UsageGauge label="Ctx" pct={ctxPct} detail={ctxDetail} />
        <UsageGauge
          label="5h"
          pct={fh?.utilization ?? null}
          detail={fh ? `(${fmtRemaining(fh.resetsAt)})` : "—"}
        />
        <UsageGauge
          label="7d"
          pct={sd?.utilization ?? null}
          detail={sd ? `(${fmtRemaining(sd.resetsAt)})` : "—"}
        />
      </div>
    </aside>
  );
}

// Drag-resizable dock height. The dock sits at the bottom, so dragging the top
// edge sets height = viewport bottom minus pointer Y. Snaps to 0 (hidden) when
// dragged past the bottom edge, otherwise clamps. Persisted across reloads.
function useChatHeight() {
  const [value, setValue] = useState(readStoredHeight);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(value));
  }, [value]);

  const onDragStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => setValue(snapHeight(window.innerHeight - ev.clientY));
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { value, dragging, onDragStart };
}

function readStoredHeight(): number {
  const raw = localStorage.getItem(HEIGHT_KEY);
  return raw === null ? 280 : snapHeight(Number(raw));
}

function snapHeight(px: number): number {
  if (px < HEIGHT_HIDE_AT) return 0;
  return Math.max(HEIGHT_MIN, Math.min(window.innerHeight * 0.8, px));
}

type ChatEvent =
  | { kind: "delta"; text: string }
  | { kind: "error"; text: string }
  | { kind: "meta"; meta: MetaFrame };

// POSTs the message and reads the SSE response via fetch-event-source, handing
// the caller a normalized ChatEvent per frame. Resolves when the server ends the
// stream (after the turn's `done`).
async function streamReply(
  message: string,
  onEvent: (ev: ChatEvent) => void,
  signal: AbortSignal,
  image?: string
): Promise<void> {
  await fetchEventSource("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(image ? { message, image } : { message }),
    signal,
    openWhenHidden: true, // local dev tool: don't drop the turn on a hidden tab
    async onopen(res) {
      if (res.ok && res.headers.get("content-type")?.startsWith(EventStreamContentType)) return;
      throw new Error(`Chat failed (${res.status}). Is the dev server running?`);
    },
    onmessage(ev) {
      if (ev.event === "render-request") {
        handleRenderRequest(ev.data);
        return; // a side effect (capture + POST back), not a chat message
      }
      const parsed = toEvent(ev.event, ev.data);
      if (parsed) onEvent(parsed);
    },
    onclose() {
      // The server ends the response after the turn's `done`; this is expected,
      // so return without throwing to avoid fetch-event-source's auto-retry.
    },
    onerror(err) {
      throw err; // a real failure: stop, don't auto-retry against a dead server
    },
  });
}

// The agent's render_slide tool asks (mid-turn) for a render of the active slide.
// Capture the live stage to a PNG and POST it back so the tool result can resolve.
// Fire-and-forget: a failure just lets the server's render timeout return null.
function handleRenderRequest(data: string): void {
  let requestId: string;
  try {
    ({ requestId } = JSON.parse(data));
  } catch {
    return;
  }
  void (async () => {
    const image = (await getSlideCapturer()?.()) ?? null;
    await fetch("/api/render-result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, image }),
    }).catch(() => {});
  })();
}

// Maps one SSE event to a ChatEvent. `delta` carries a JSON-encoded text chunk,
// `error` a JSON-encoded message; `done`/unknown are ignored.
function toEvent(event: string, data: string): ChatEvent | null {
  if (event === "delta") {
    try {
      return { kind: "delta", text: JSON.parse(data) };
    } catch {
      return null;
    }
  }
  if (event === "error") {
    let text = data;
    try {
      text = JSON.parse(data);
    } catch {
      /* fall back to raw */
    }
    return { kind: "error", text: text || "Claude Code failed to start." };
  }
  if (event === "meta") {
    try {
      return { kind: "meta", meta: JSON.parse(data) as MetaFrame };
    } catch {
      return null;
    }
  }
  return null;
}

function appendToLast(setMessages: React.Dispatch<React.SetStateAction<Message[]>>, text: string): void {
  setMessages((m) => {
    const last = m[m.length - 1];
    if (!last || last.role !== "assistant") return m;
    return [...m.slice(0, -1), { ...last, text: last.text + text }];
  });
}
