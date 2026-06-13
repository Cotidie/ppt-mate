// Dev-only API for mutating deck.json from the preview UI.
// Server is authoritative: it reads, edits, and rewrites the file by id, so the
// client never ships a whole deck back. The file write triggers Vite HMR, which
// reloads the preview with the new deck.

import type { Plugin, Connect } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK_PATH = resolve(HERE, "deck.json");
const THEME_PATH = resolve(HERE, "theme.json");
const OUT_DIR = resolve(HERE, "out");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "opus";
const CREDS_PATH = resolve(homedir(), ".claude/.credentials.json");

// Captured so the export route can load the TypeScript exporter through Vite's
// transform pipeline (ssrLoadModule) - plain Node can't import the .mts/.ts directly.
let devServer: import("vite").ViteDevServer | null = null;

export function deckApi(): Plugin {
  return {
    name: "deck-api",
    configureServer(server) {
      devServer = server;
      server.middlewares.use("/api/slides/delete", handleDeleteSlide);
      server.middlewares.use("/api/slides/rename", handleRenameSlide);
      server.middlewares.use("/api/slides/edit", handleEditSlide);
      server.middlewares.use("/api/slides/move-batch", handleMoveBatch);
      server.middlewares.use("/api/slides/move", handleMoveSlide);
      server.middlewares.use("/api/slides/reset-offsets", handleResetOffsets);
      server.middlewares.use("/api/footer", handleEditFooter);
      server.middlewares.use("/api/theme/edit", handleEditTheme);
      server.middlewares.use("/api/export", handleExport);
      server.middlewares.use("/api/account", handleAccount);
      server.middlewares.use("/api/usage", handleUsage);
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

// Claude account info for the ChatDock panel: who's signed in and on what plan.
// Pulled from `claude auth status --json` (the only programmatic source). Cached
// for the dev-server lifetime since auth rarely changes mid-session; a failed
// read drops the cache so the next request retries.
let accountCache: Promise<unknown> | null = null;

function handleAccount(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "GET") return next();
  (accountCache ??= readAccount()).then(
    (info) => sendJson(res, 200, info),
    (err) => {
      accountCache = null;
      sendJson(res, 500, { error: String(err) });
    },
  );
}

function readAccount(): Promise<unknown> {
  return new Promise((resolveAcct, reject) => {
    const child = spawn(CLAUDE_BIN, ["auth", "status", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", () => {
      try {
        const j = JSON.parse(out);
        resolveAcct({
          loggedIn: j.loggedIn,
          email: j.email,
          authMethod: j.authMethod,
          subscriptionType: j.subscriptionType,
          orgName: j.orgName,
          model: CLAUDE_MODEL, // alias; the live model id arrives via the chat stream's `meta`
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Claude usage limits for the ChatDock panel: 5-hour and 7-day rolling windows.
// Fetched from the OAuth usage endpoint (requires the access token from the
// credentials file that the CLI keeps refreshed). Cached 30s to avoid hammering
// the API on every chat turn; on any failure, returns `{available:false}` so the
// panel degrades to "—" rather than erroring.
type UsageCache = { value: unknown; at: number } | null;
let usageCache: UsageCache = null;
const USAGE_TTL_MS = 30_000;

function handleUsage(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "GET") return next();
  const now = Date.now();
  const cached = usageCache && now - usageCache.at < USAGE_TTL_MS ? usageCache.value : null;
  if (cached) { sendJson(res, 200, cached); return; }
  readUsage().then(
    (info) => { usageCache = { value: info, at: Date.now() }; sendJson(res, 200, info); },
    () => sendJson(res, 200, { available: false }),
  );
}

async function readUsage(): Promise<unknown> {
  const creds = JSON.parse(await readFile(CREDS_PATH, "utf8"));
  const token: string = creds?.claudeAiOauth?.accessToken;
  if (!token) return { available: false };
  const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
    },
  });
  if (!r.ok) return { available: false };
  const j = await r.json() as { five_hour?: { utilization?: number; resets_at?: string }; seven_day?: { utilization?: number; resets_at?: string } };
  return {
    available: true,
    fiveHour: j.five_hour ? { utilization: j.five_hour.utilization ?? 0, resetsAt: j.five_hour.resets_at ?? "" } : null,
    sevenDay: j.seven_day ? { utilization: j.seven_day.utilization ?? 0, resetsAt: j.seven_day.resets_at ?? "" } : null,
  };
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
      } else if (msg.type === "system" && (msg as { subtype?: string }).subtype === "init") {
        // Init carries the resolved model id (e.g. "claude-opus-4-8"), once per session.
        const model = (msg as { model?: string }).model;
        if (model) this.send("meta", JSON.stringify({ model }));
      } else if (msg.type === "result") {
        // Context-window gauge: how many tokens have been consumed this session and
        // how large the window is, so the panel can show e.g. "110K / 1.0M  11%".
        type ResultMsg = {
          usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
          modelUsage?: Record<string, { contextWindow?: number }>;
        };
        const r = msg as ResultMsg;
        const u = r.usage;
        if (u) {
          const contextUsed = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          const models = r.modelUsage ? Object.values(r.modelUsage) : [];
          const contextWindow = models[0]?.contextWindow ?? 1_000_000;
          this.send("meta", JSON.stringify({ contextUsed, contextWindow }));
          // Invalidate the usage cache so the next /api/usage call fetches fresh 5h/7d data.
          usageCache = null;
        }
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

// Drag-to-move / drag-to-resize: accumulate a per-element geometry override
// (inches) on the slide. setByPath can't create the `overrides` map, so this has
// its own route. The client sends incremental deltas (dx/dy shift, dw/dh resize);
// we add them to any prior override so repeated gestures compose. Key is the
// resolver's stable element key (e.g. "title", "table"). Body-move sends dw/dh=0.
async function handleMoveSlide(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id, key, dx, dy, dw, dh } = await readJsonBody(req);
    await transformSlideElement(id, key, {
      dx: Number(dx) || 0,
      dy: Number(dy) || 0,
      dw: Number(dw) || 0,
      dh: Number(dh) || 0,
    });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

type Delta = { dx: number; dy: number; dw: number; dh: number };

async function transformSlideElement(id: string, key: string, d: Delta): Promise<void> {
  await transformSlideElements(id, [{ key, ...d }]);
}

// Group move: apply many per-element deltas to one slide in a single
// read-modify-write so the whole group commits atomically (one HMR, no file
// race between members). Each delta composes onto that element's prior override,
// exactly like the single-element path.
async function handleMoveBatch(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id, moves } = await readJsonBody(req);
    const list = (Array.isArray(moves) ? moves : []).map((m) => ({
      key: m.key,
      dx: Number(m.dx) || 0,
      dy: Number(m.dy) || 0,
      dw: Number(m.dw) || 0,
      dh: Number(m.dh) || 0,
    }));
    await transformSlideElements(id, list);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function transformSlideElements(id: string, moves: ({ key: string } & Delta)[]): Promise<void> {
  const valid = moves.filter((m) => m.key && [m.dx, m.dy, m.dw, m.dh].every(Number.isFinite));
  if (!valid.length) return;
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide) return;
  slide.overrides ??= {};
  for (const m of valid) {
    const prev = slide.overrides[m.key] ?? {};
    const next = {
      dx: (prev.dx ?? 0) + m.dx,
      dy: (prev.dy ?? 0) + m.dy,
      dw: (prev.dw ?? 0) + m.dw,
      dh: (prev.dh ?? 0) + m.dh,
    };
    // Keep the stored override sparse: drop axes that net to zero.
    slide.overrides[m.key] = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== 0));
  }
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// Reset layout: drop all element overrides on a slide so elements return to their
// computed position and size. The whole `overrides` map is removed (per-slide undo).
async function handleResetOffsets(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { id } = await readJsonBody(req);
    await resetSlideOverrides(id);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function resetSlideOverrides(id: string): Promise<void> {
  const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
  const slide = deck.slides.find((s: { id: string }) => s.id === id);
  if (!slide || !slide.overrides) return;
  delete slide.overrides;
  await writeFile(DECK_PATH, JSON.stringify(deck, null, 2) + "\n", "utf8");
}

// Export the deck from the UI. Always rebuild out/deck.pptx from the CURRENT
// deck.json (the pptx mirrors the preview by construction); for PDF, convert that
// pptx with headless LibreOffice (soffice) so the PDF matches by construction too.
// Streams the file back as a download. PDF fidelity depends on the deck's fonts
// being available to LibreOffice (missing fonts get substituted).
let exporting: Promise<void> | null = null; // serialize: one export at a time

async function handleExport(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "GET") return next();
  const format = new URL(req.url ?? "", "http://localhost").searchParams.get("format") === "pptx"
    ? "pptx"
    : "pdf";
  // Chain onto any in-flight export so concurrent clicks don't race soffice.
  const run = (exporting ?? Promise.resolve()).then(() => streamExport(res, format));
  exporting = run.then(
    () => undefined,
    () => undefined,
  );
  try {
    await run;
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: String(err) });
  }
}

async function streamExport(res: ServerResponse, format: "pdf" | "pptx"): Promise<void> {
  if (!devServer) throw new Error("dev server not ready");
  // ssrLoadModule transforms the exporter + its src/ TS imports through Vite.
  const mod = (await devServer.ssrLoadModule("/export/export-pptx.mts")) as {
    buildPptx: () => Promise<string>;
  };
  const pptxPath = await mod.buildPptx();
  const path = format === "pptx" ? pptxPath : await pptxToPdf(pptxPath);
  const body = await readFile(path);
  res.statusCode = 200;
  res.setHeader(
    "content-type",
    format === "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : "application/pdf",
  );
  res.setHeader("content-disposition", `attachment; filename="deck.${format}"`);
  res.end(body);
}

function pptxToPdf(pptxPath: string): Promise<string> {
  return new Promise((resolveP, reject) => {
    const child = spawn(
      "soffice",
      [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        OUT_DIR,
        pptxPath,
        // Isolated profile so we don't collide with a running LibreOffice instance.
        "-env:UserInstallation=file:///tmp/ppt-mate-lo",
      ],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveP(resolve(OUT_DIR, "deck.pdf")) : reject(new Error(`soffice exited ${code}`)),
    );
  });
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

async function handleEditTheme(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { path, value } = await readJsonBody(req);
    await editThemeField(String(path), value);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function editThemeField(path: string, value: unknown): Promise<void> {
  const theme = JSON.parse(await readFile(THEME_PATH, "utf8"));
  setByPath(theme, path, value);
  await writeFile(THEME_PATH, JSON.stringify(theme, null, 2) + "\n", "utf8");
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
