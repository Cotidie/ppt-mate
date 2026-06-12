// Dev-only API for mutating deck.json from the preview UI.
// Server is authoritative: it reads, edits, and rewrites the file by id, so the
// client never ships a whole deck back. The file write triggers Vite HMR, which
// reloads the preview with the new deck.

import type { Plugin, Connect } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK_PATH = resolve(HERE, "deck.json");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "opus";

export function deckApi(): Plugin {
  return {
    name: "deck-api",
    configureServer(server) {
      server.middlewares.use("/api/slides/delete", handleDeleteSlide);
      server.middlewares.use("/api/slides/rename", handleRenameSlide);
      server.middlewares.use("/api/slides/edit", handleEditSlide);
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

// A single persistent `claude` process driven in stream-json mode. Turns are
// serialized (one conversation, one stdin), so only one is active at a time; its
// output lines route to that turn's SSE response until the `result` event. The
// child lazy-starts on first turn and respawns after a reset or crash.
class ClaudeSession {
  private child?: ChildProcessWithoutNullStreams;
  private queue: Promise<void> = Promise.resolve();
  private activeRes?: ServerResponse;
  private endTurn?: () => void;

  runTurn(message: string, res: ServerResponse): Promise<void> {
    const turn = this.queue.then(() => this.execTurn(message, res));
    this.queue = turn.catch(() => {}); // a failed turn must not wedge the queue
    return turn;
  }

  reset(): void {
    this.child?.kill();
    this.child = undefined;
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
      this.child!.stdin.write(userMessageLine(message) + "\n");
    });
  }

  private ensureStarted(): void {
    if (this.child) return;
    const child = spawn(CLAUDE_BIN, persistentArgs(), { cwd: HERE, stdio: ["pipe", "pipe", "pipe"] });
    pipeLines(child.stdout, (line) => this.routeLine(line));
    pipeLines(child.stderr, (line) => this.send("stderr", line));
    child.on("error", (err) => this.failTurn(String(err)));
    child.on("exit", () => this.handleExit());
    this.child = child;
  }

  // Forwards an output line to the active turn and ends the turn on `result`.
  private routeLine(line: string): void {
    this.send("message", line);
    if (isResultLine(line)) this.endTurn?.();
  }

  private handleExit(): void {
    this.child = undefined;
    this.failTurn("Claude Code process exited.");
  }

  private failTurn(reason: string): void {
    if (!this.endTurn) return;
    this.send("error", reason);
    this.endTurn();
  }

  private send(event: string, data: string): void {
    if (this.activeRes) sendEvent(this.activeRes, event, data);
  }
}

// One long-lived Claude Code process per dev server, shared across chat turns.
const claude = new ClaudeSession();

function persistentArgs(): string[] {
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
    "--model", CLAUDE_MODEL,
  ];
}

function userMessageLine(message: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: message } });
}

function isResultLine(line: string): boolean {
  try {
    return JSON.parse(line).type === "result";
  } catch {
    return false;
  }
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

// One SSE frame per event. `data` is a single line (no embedded newlines from
// the CLI's NDJSON), so a one-line data payload is sufficient.
function sendEvent(res: ServerResponse, event: string, data: string): void {
  if (res.writableEnded) return; // client disconnected mid-turn
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

// Buffers a child stream and invokes `onLine` once per complete `\n`-delimited
// line, flushing any trailing partial on stream end.
function pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
  stream.on("end", () => {
    if (buf) onLine(buf);
  });
}
