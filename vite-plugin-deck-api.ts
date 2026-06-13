// Dev-only API for mutating deck.json from the preview UI.
// Server is authoritative: it reads, edits, and rewrites the file by id, so the
// client never ships a whole deck back. The file write triggers Vite HMR, which
// reloads the preview with the new deck.

import type { Plugin, Connect } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK_PATH = resolve(HERE, "deck.json");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "opus";

export function deckApi(): Plugin {
  return {
    name: "deck-api",
    configureServer(server) {
      server.middlewares.use("/api/slides/delete", handleDeleteSlide);
      server.middlewares.use("/api/slides/rename", handleRenameSlide);
      server.middlewares.use("/api/slides/edit", handleEditSlide);
      server.middlewares.use("/api/slides/move", handleMoveSlide);
      server.middlewares.use("/api/slides/reset-offsets", handleResetOffsets);
      server.middlewares.use("/api/footer", handleEditFooter);
      server.middlewares.use("/api/chat/reset", handleChatReset);
      server.middlewares.use("/api/chat", handleChat);
      bindShutdown(server.httpServer);
    },
  };
}

// The headless session must die with the dev server. Three guards: explicit kill
// on httpServer close and on process signals/exit, plus stdin-EOF (the child
// reads from a pipe we own, so a hard parent death closes it and Claude exits).
function bindShutdown(httpServer: import("node:http").Server | null): void {
  const stop = () => claude.dispose();
  httpServer?.once("close", stop);
  process.once("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      stop();
      process.exit(0);
    });
  }
}

async function handleDeleteSlide(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id } = await readJsonBody(req);
    await deleteSlideById(id);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleRenameSlide(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id, label } = await readJsonBody(req);
    await renameSlideById(id, label);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// Chats with the local Claude Code CLI over the shared long-lived session. One
// HTTP request per user turn: the message goes to the child's stdin and its
// NDJSON output streams back to the browser over SSE until the turn's `result`.
async function handleChat(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { message } = await readJsonBody(req);
    openEventStream(res);
    await claude.runTurn(message, res);
    sendEvent(res, "done", "");
    res.end();
  } catch (err) {
    sendEvent(res, "error", String(err));
    res.end();
  }
}

// Ends the current conversation: kills the child so the next turn starts fresh.
function handleChatReset(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  claude.reset();
  sendJson(res, 200, { ok: true });
}

// A single persistent Claude Agent SDK session per dev server, driven in
// streaming-input mode: one long-lived `query` whose prompt is a pushable stream,
// so every chat turn feeds the same conversation. Turns are serialized (one
// active at a time); the SDK's partial-message text deltas route to that turn's
// SSE response until its `result` message. Lazy-starts on first turn; a reset
// interrupts the query so the next turn opens a fresh session.
class ClaudeSession {
  private input?: PushableInput;
  private q?: ReturnType<typeof query>;
  private queue: Promise<void> = Promise.resolve();
  private activeRes?: ServerResponse;
  private endTurn?: () => void;

  runTurn(message: string, res: ServerResponse): Promise<void> {
    const turn = this.queue.then(() => this.execTurn(message, res));
    this.queue = turn.catch(() => {}); // a failed turn must not wedge the queue
    return turn;
  }

  reset(): void {
    void this.q?.interrupt().catch(() => {});
    this.input?.close();
    this.q = undefined;
    this.input = undefined;
  }

  dispose(): void {
    this.reset();
  }

  private execTurn(message: string, res: ServerResponse): Promise<void> {
    this.ensureStarted();
    return new Promise<void>((resolve) => {
      this.activeRes = res;
      this.endTurn = () => {
        this.activeRes = undefined;
        this.endTurn = undefined;
        resolve();
      };
      this.input!.push(message);
    });
  }

  private ensureStarted(): void {
    if (this.q) return;
    const input = createInputStream();
    const q = query({
      prompt: input.stream,
      options: {
        cwd: HERE,
        model: CLAUDE_MODEL,
        permissionMode: "bypassPermissions",
        includePartialMessages: true,
      },
    });
    this.input = input;
    this.q = q;
    void this.consume(q).catch((err) => this.failTurn(String(err)));
  }

  // Streams SDK messages to the active turn: text deltas as `delta` events, the
  // turn boundary on `result`. Errors end the turn. When the iterable ends
  // (interrupt or crash), drop the session so the next turn reopens one.
  private async consume(q: AsyncIterable<SDKMessage>): Promise<void> {
    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          this.send("delta", JSON.stringify(ev.delta.text));
        }
      } else if (msg.type === "result") {
        this.endTurn?.();
      }
    }
    this.q = undefined;
    this.input = undefined;
    this.failTurn("Claude session ended.");
  }

  private failTurn(reason: string): void {
    if (!this.endTurn) return;
    this.send("error", JSON.stringify(reason));
    this.endTurn();
  }

  private send(event: string, data: string): void {
    if (this.activeRes) sendEvent(this.activeRes, event, data);
  }
}

// One long-lived Claude session per dev server, shared across chat turns.
const claude = new ClaudeSession();

// A pushable async iterable of SDKUserMessages: the SDK consumes `stream` while
// we `push` a user turn into it on demand and `close` it on reset.
type PushableInput = {
  stream: AsyncGenerator<SDKUserMessage>;
  push: (text: string) => void;
  close: () => void;
};

function createInputStream(): PushableInput {
  const buffer: SDKUserMessage[] = [];
  let waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  let closed = false;

  const stream = (async function* () {
    while (true) {
      if (buffer.length) {
        yield buffer.shift()!;
        continue;
      }
      if (closed) return;
      const next = await new Promise<IteratorResult<SDKUserMessage>>((r) => (waiting = r));
      if (next.done) return;
      yield next.value;
    }
  })();

  return {
    stream,
    push(text) {
      const msg = {
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      } as SDKUserMessage;
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ value: msg, done: false });
      } else {
        buffer.push(msg);
      }
    },
    close() {
      closed = true;
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ value: undefined as never, done: true });
      }
    },
  };
}

// Inline slide text edit: sets one rich-text field (by dotted path) on the
// slide and rewrites deck.json. The value is a Span[] array. Path examples:
// "title", "bullets.2.runs", "cards.0.bullets.1.runs", "rows.0.cells.2".
async function handleEditSlide(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id, path, value } = await readJsonBody(req);
    await editSlideField(id, path, value);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function editSlideField(id: string, path: string, value: unknown): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide) return;
  setByPath(slide, path, value);
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// Walks a dotted path (numeric segments index arrays) and writes the leaf. Bails
// if the path doesn't resolve, so a stale path can never create junk keys.
function setByPath(root: any, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node?.[parts[i]];
    if (node == null) return;
  }
  const leaf = parts[parts.length - 1];
  if (node != null && leaf in node) node[leaf] = value;
}

// Drag-to-move: accumulate a per-element position offset (inches) on the slide.
// setByPath can't create the `offsets` map, so this has its own route. The client
// sends an incremental delta; we add it to any prior offset so repeated drags
// compose. Key is the resolver's stable element key (e.g. "title", "table").
async function handleMoveSlide(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id, key, dx, dy } = await readJsonBody(req);
    await moveSlideElement(id, key, Number(dx), Number(dy));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function moveSlideElement(id: string, key: string, dx: number, dy: number): Promise<void> {
  if (!key || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide) return;
  slide.offsets ??= {};
  const prev = slide.offsets[key] ?? { dx: 0, dy: 0 };
  slide.offsets[key] = { dx: prev.dx + dx, dy: prev.dy + dy };
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// Reset position: drop all element offsets on a slide so elements return to
// their computed positions. The whole `offsets` map is removed (per-slide undo).
async function handleResetOffsets(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id } = await readJsonBody(req);
    await resetSlideOffsets(id);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function resetSlideOffsets(id: string): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide || !slide.offsets) return;
  delete slide.offsets;
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// The footer is deck-wide (deck.meta.footer), shown on every slide. Editing it
// from any slide updates the single meta string, so all slides reflect it.
async function handleEditFooter(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { value } = await readJsonBody(req);
    await editFooter(String(value));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function editFooter(value: string): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  deck.meta ??= {};
  deck.meta.footer = value;
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

async function deleteSlideById(id: string): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  deck.slides = deck.slides.filter((s: { id: string }) => s.id !== id);
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// Sets the sidebar-only navLabel. A blank label, or one equal to the title,
// drops the field so the label falls back to the title.
async function renameSlideById(id: string, label: string): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide) return;
  const trimmed = (label ?? "").trim();
  // slide.title is rich text (Span[]); compare against its flattened plain text.
  const titleText = Array.isArray(slide.title)
    ? slide.title.map((s: { text: string }) => s.text).join("")
    : "";
  if (!trimmed || trimmed === titleText) delete slide.navLabel;
  else slide.navLabel = trimmed;
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function openEventStream(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
}

// One SSE frame per event. `data` is a single line: delta/error payloads are
// JSON-encoded strings (newlines escaped), so a one-line data field is safe.
function sendEvent(res: ServerResponse, event: string, data: string): void {
  if (res.writableEnded) return; // client disconnected mid-turn
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}
