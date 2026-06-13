import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { fetchEventSource, EventStreamContentType } from "@microsoft/fetch-event-source";

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
// One `meta` SSE frame: model (once, on init) or cost+usage (per result).
type Usage = { input_tokens?: number; output_tokens?: number };
type MetaFrame = { model?: string; cost?: number; usage?: Usage };
// Accumulated session stats shown in the panel: cost is cumulative from the
// server, tokens summed across this session's turns.
type Stats = { model?: string; cost?: number; tokens?: number };

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
  }, []);

  const send = async () => {
    const message = input.trim();
    if (!message || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }, { role: "assistant", text: "" }]);
    setStreaming(true);
    try {
      await streamReply(message, applyEvent, new AbortController().signal);
    } catch (err) {
      applyEvent({ kind: "error", text: String(err) });
    } finally {
      setStreaming(false);
    }
  };

  // Ends the conversation: tells the server to kill its Claude process and wipes
  // the local transcript so the next message starts fresh.
  const newChat = async () => {
    setMenuOpen(false);
    if (streaming) return;
    await fetch("/api/chat/reset", { method: "POST" }).catch(() => {});
    setMessages([]);
    setStats((s) => ({ model: s.model })); // fresh process: cost/tokens restart
  };

  // Folds a parsed SSE event into the message list. Assistant text deltas append
  // to the in-flight (last) message; errors are pushed as their own line.
  const applyEvent = (ev: ChatEvent) => {
    if (ev.kind === "delta") appendToLast(setMessages, ev.text);
    else if (ev.kind === "error") setMessages((m) => [...m, { role: "error", text: ev.text }]);
    else if (ev.kind === "meta")
      setStats((prev) => {
        const f = ev.meta;
        return {
          model: f.model ?? prev.model,
          cost: f.cost ?? prev.cost, // server-cumulative
          tokens: f.usage
            ? (prev.tokens ?? 0) + (f.usage.input_tokens ?? 0) + (f.usage.output_tokens ?? 0)
            : prev.tokens,
        };
      });
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
      <AccountPanel account={account} stats={stats} />
      <div className="chat-col">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={"chat-msg chat-" + m.role}>
            {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
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

// Left-rail panel inside the dock: Claude account, active model, and live session
// cost/usage. Static account fields come from /api/account; model and cost/tokens
// stream in from the chat turns (`meta` frames). Falls back gracefully before any
// turn has run (cost/tokens show "—").
function AccountPanel({ account, stats }: { account: Account | null; stats: Stats }) {
  const model = stats.model ?? account?.model;
  return (
    <aside className="chat-panel">
      <div className="cp-section">
        <div className="cp-label">Account</div>
        <div className="cp-value" title={account?.email}>{account?.email ?? "…"}</div>
        {account?.subscriptionType && (
          <span className="cp-badge">{account.subscriptionType}</span>
        )}
      </div>
      <div className="cp-section">
        <div className="cp-label">Model</div>
        <div className="cp-value" title={model}>{model ?? "…"}</div>
      </div>
      <div className="cp-section">
        <div className="cp-label">Session</div>
        <div className="cp-stat">
          <span>Cost</span>
          <span>{stats.cost != null ? `$${stats.cost.toFixed(4)}` : "—"}</span>
        </div>
        <div className="cp-stat">
          <span>Tokens</span>
          <span>{stats.tokens != null ? stats.tokens.toLocaleString() : "—"}</span>
        </div>
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
  signal: AbortSignal
): Promise<void> {
  await fetchEventSource("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
    openWhenHidden: true, // local dev tool: don't drop the turn on a hidden tab
    async onopen(res) {
      if (res.ok && res.headers.get("content-type")?.startsWith(EventStreamContentType)) return;
      throw new Error(`Chat failed (${res.status}). Is the dev server running?`);
    },
    onmessage(ev) {
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
