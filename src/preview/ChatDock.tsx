import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type Role = "user" | "assistant" | "error";
type Message = { role: Role; text: string };

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
  const height = useChatHeight();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const message = input.trim();
    if (!message || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }, { role: "assistant", text: "" }]);
    setStreaming(true);
    try {
      await streamReply(message, applyEvent);
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
  };

  // Folds a parsed SSE event into the message list. Assistant text deltas append
  // to the in-flight (last) message; errors are pushed as their own line.
  const applyEvent = (ev: ChatEvent) => {
    if (ev.kind === "delta") appendToLast(setMessages, ev.text);
    else if (ev.kind === "error") setMessages((m) => [...m, { role: "error", text: ev.text }]);
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
        <>
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
        </>
      )}
    </div>
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
  | { kind: "error"; text: string };

// POSTs the message and reads the SSE response, decoding each frame and handing
// the caller a normalized ChatEvent. Resolves when the stream ends.
async function streamReply(message: string, onEvent: (ev: ChatEvent) => void): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status}). Is the dev server running?`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev = parseFrame(frame);
      if (ev) onEvent(ev);
    }
  }
}

// Turns one SSE frame into a ChatEvent. The server sends clean events now:
// `delta` carries a JSON-encoded text chunk, `error` a JSON-encoded message,
// `done` ends the turn.
function parseFrame(frame: string): ChatEvent | null {
  const event = matchField(frame, "event") ?? "message";
  const data = matchField(frame, "data") ?? "";
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
  return null; // done / unknown
}

function matchField(frame: string, field: string): string | undefined {
  const line = frame.split("\n").find((l) => l.startsWith(field + ": "));
  return line?.slice(field.length + 2);
}

function appendToLast(setMessages: React.Dispatch<React.SetStateAction<Message[]>>, text: string): void {
  setMessages((m) => {
    const last = m[m.length - 1];
    if (!last || last.role !== "assistant") return m;
    return [...m.slice(0, -1), { ...last, text: last.text + text }];
  });
}
