// Dev-only API for mutating deck.json from the preview UI.
// Server is authoritative: it reads, edits, and rewrites the file by id, so the
// client never ships a whole deck back. The file write triggers Vite HMR, which
// reloads the preview with the new deck.

import type { Plugin, Connect } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, readdir, stat, mkdir, rename as renameFs, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { query, createSdkMcpServer, tool, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import prettyBytes from "pretty-bytes";
import mimeTypes from "mime-types";
import { isBinary } from "istextorbinary";
import open from "open";

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK_PATH = resolve(HERE, "deck.json");
const THEME_PATH = resolve(HERE, "theme.json");
const OUT_DIR = resolve(HERE, "out");
// The app's workspace: user/agent assets (generated images, uploaded PDFs, notes).
// The agent sees the tree every turn but reads contents only on demand.
const WORKSPACE_DIR = resolve(HERE, "files");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "opus";
const CREDS_PATH = resolve(homedir(), ".claude/.credentials.json");
// User-scope memory to keep OUT of the deck agent. settingSources:["project"]
// gates *whether* CLAUDE.md loads, but once on it loads the whole memory
// hierarchy (user + project); this excludes the global file by path so only the
// project's CLAUDE.md reaches the agent.
const USER_CLAUDE_MD = resolve(homedir(), ".claude/CLAUDE.md");

// The slide-authoring brief, appended to the agent's system prompt to specialize
// it (read once at startup; editable like design/DESIGN.md). Missing file -> "".
const AGENT_BRIEF = ((): string => {
  try {
    return readFileSync(resolve(HERE, "agent/SLIDE_AGENT.md"), "utf8");
  } catch {
    return "";
  }
})();

// Live UI context, kept fresh by the browser via POST /api/context. The agent
// sees it two ways: a compact header injected into each turn, and the `deck` MCP
// tools that read it on demand. Fields are additive (future: selectedText,
// region, pointer) so awareness can grow without re-architecture.
type RenderFact = { overflowLines?: number; overflowInches?: number; offCanvas?: boolean };
type TextSel = { elementKey: string; path?: string; text: string; start?: number; end?: number };
type UiContext = {
  activeSlideId?: string;
  selection?: string[];
  selectedText?: TextSel | null;
  render?: Record<string, RenderFact>;
};
let uiContext: UiContext = {};

// Captured so the export route can load the TypeScript exporter through Vite's
// transform pipeline (ssrLoadModule) - plain Node can't import the .mts/.ts directly.
let devServer: import("vite").ViteDevServer | null = null;

export function deckApi(): Plugin {
  return {
    name: "deck-api",
    configureServer(server) {
      devServer = server;
      // Always have a workspace directory so the explorer + agent tools work.
      void mkdir(WORKSPACE_DIR, { recursive: true }).catch(() => {});
      server.middlewares.use("/api/slides/delete", handleDeleteSlide);
      server.middlewares.use("/api/slides/rename", handleRenameSlide);
      server.middlewares.use("/api/slides/edit", handleEditSlide);
      server.middlewares.use("/api/slides/move-batch", handleMoveBatch);
      server.middlewares.use("/api/slides/move", handleMoveSlide);
      server.middlewares.use("/api/slides/reset-offsets", handleResetOffsets);
      server.middlewares.use("/api/footer", handleEditFooter);
      server.middlewares.use("/api/context", handleContext);
      server.middlewares.use("/api/render-result", handleRenderResult);
      server.middlewares.use("/api/workspace/upload", handleWorkspaceUpload);
      server.middlewares.use("/api/workspace/open", handleWorkspaceOpen);
      server.middlewares.use("/api/workspace/mkdir", handleWorkspaceMkdir);
      server.middlewares.use("/api/workspace/rename", handleWorkspaceRename);
      server.middlewares.use("/api/workspace/remove", handleWorkspaceRemove);
      server.middlewares.use("/api/workspace", handleWorkspace);
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
    const { message, image, mode, visual } = await readJsonBody(req);
    openEventStream(res);
    // A turn needs content. Typed prose counts; so does a non-default execution
    // mode (e.g. Fix Layout), whose prepended hint IS the instruction and which
    // the agent runs against the active slide. Reject only when neither is present.
    const blank = typeof message !== "string" || !message.trim();
    if (blank && !(typeof mode === "string" && EXEC_HINTS[mode])) {
      sendEvent(res, "error", JSON.stringify("Type a message or pick an execution mode."));
      sendEvent(res, "done", "");
      res.end();
      return;
    }
    await claude.runTurn(await composeTurn(typeof message === "string" ? message : "", image, mode, visual), res);
    sendEvent(res, "done", "");
    res.end();
  } catch (err) {
    sendEvent(res, "error", String(err));
    res.end();
  }
}

// The browser pushes live UI state here (active slide, selection, render facts).
// Partial merge: each call updates only the fields it carries.
async function handleContext(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const body = await readJsonBody(req);
    Object.assign(uiContext, body);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// The browser answers a `render-request` here with the captured slide PNG,
// resolving the render_slide tool's parked promise. Fire-and-forget from the
// client; a late/unknown id is ignored (already timed out).
async function handleRenderResult(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const { requestId, image } = await readJsonBody(req);
    const pending = pendingRenders.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRenders.delete(requestId);
      pending.resolve(typeof image === "string" && image ? image : null);
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Workspace: a `files/` tree the agent is always aware of (a compact manifest
// rides each turn) but whose contents it reads only on demand (MCP tools below).
// Single source of truth: the tree feeds the UI explorer, the turn manifest, and
// the list_workspace tool.
// ---------------------------------------------------------------------------
type TreeNode = {
  name: string;
  path: string; // relative to files/, POSIX separators
  type: "dir" | "file";
  size?: number;
  mtime?: number; // epoch ms
  children?: TreeNode[];
  truncated?: boolean; // dir had more entries than the cap
  summary?: string; // reserved: future generated per-file summary (unused in v1)
};

const WS_MAX_DEPTH = 5;
const WS_MAX_ENTRIES = 300;

// Recursive readdir+stat under files/, depth- and entry-capped so a huge tree
// can't blow up the response or the turn header. Dirs sorted before files.
async function buildWorkspaceTree(): Promise<TreeNode> {
  const root: TreeNode = { name: "files", path: "", type: "dir", children: [] };
  let budget = WS_MAX_ENTRIES;
  async function walk(absDir: string, relDir: string, depth: number): Promise<TreeNode[]> {
    if (depth > WS_MAX_DEPTH || budget <= 0) return [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad - bd || a.name.localeCompare(b.name);
    });
    const out: TreeNode[] = [];
    for (const e of entries) {
      if (budget <= 0) {
        out.push({ name: "…", path: relDir, type: "file", truncated: true });
        break;
      }
      budget--;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = resolve(absDir, e.name);
      if (e.isDirectory()) {
        out.push({ name: e.name, path: rel, type: "dir", children: await walk(abs, rel, depth + 1) });
      } else if (e.isFile()) {
        let size: number | undefined;
        let mtime: number | undefined;
        try {
          const s = await stat(abs);
          size = s.size;
          mtime = s.mtimeMs;
        } catch {
          /* unreadable: list it without metadata */
        }
        out.push({ name: e.name, path: rel, type: "file", size, mtime });
      }
    }
    return out;
  }
  root.children = await walk(WORKSPACE_DIR, "", 1);
  return root;
}

// Flatten the tree to a compact one-line-per-entry manifest for the turn header.
// Lists up to `limit` entries (dir-first, depth order), then "… N more". Never
// includes file contents - just structure + metadata.
function workspaceManifest(tree: TreeNode, limit = 60): string {
  const lines: string[] = [];
  let total = 0;
  const walk = (nodes: TreeNode[] | undefined, depth: number) => {
    for (const n of nodes ?? []) {
      total++;
      if (lines.length < limit) {
        const indent = "  ".repeat(depth);
        if (n.type === "dir") lines.push(`${indent}${n.name}/`);
        else {
          const meta = [n.size != null ? prettyBytes(n.size) : null, n.mtime ? fmtDate(n.mtime) : null]
            .filter(Boolean)
            .join(", ");
          lines.push(`${indent}${n.name}${meta ? ` (${meta})` : ""}`);
        }
      }
      if (n.type === "dir") walk(n.children, depth + 1);
    }
  };
  walk(tree.children, 0);
  if (!lines.length) return "[workspace] files/ is empty";
  const more = total > limit ? `\n  … ${total - limit} more` : "";
  return `[workspace] files/\n${lines.join("\n")}${more}`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Resolve a workspace-relative path to an absolute one, refusing anything that
// escapes files/ (path traversal). Returns null if outside the sandbox.
function resolveWorkspacePath(rel: string): string | null {
  const abs = resolve(WORKSPACE_DIR, rel);
  if (abs !== WORKSPACE_DIR && !abs.startsWith(WORKSPACE_DIR + "/")) return null;
  return abs;
}

// GET /api/workspace -> the file tree (consumed by the explorer UI).
async function handleWorkspace(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "GET") return next();
  try {
    const tree = await buildWorkspaceTree();
    sendJson(res, 200, tree);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// Shared skeleton for the POST workspace mutation routes: method guard, JSON
// body parse, uniform 500 on throw. Each handler just maps a parsed body to a
// { status, body } pair.
type RouteResult = { status: number; body: unknown };

function workspaceRoute(fn: (body: any) => Promise<RouteResult>) {
  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (req.method !== "POST") return next();
    try {
      const { status, body } = await fn(await readJsonBody(req));
      sendJson(res, status, body);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };
}

// A single path segment is valid as a workspace file/folder name when it is
// non-empty, not "."/".." and carries no separator or NUL. Returns the trimmed
// name, or null if invalid.
function validWorkspaceName(raw: unknown): string | null {
  const name = String(raw ?? "").trim();
  if (!name || name === "." || name === "..") return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  return name;
}

// Workspace-relative child path under `parent` ("" = root).
function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

// POST /api/workspace/open { path } -> open a workspace file with the host's
// default app (the dev server runs on the user's machine). Sandboxed to files/.
// Only meaningful for local use (browser + dev server on the same host).
const handleWorkspaceOpen = workspaceRoute(async ({ path }) => {
  const abs = resolveWorkspacePath(String(path ?? ""));
  if (!abs) return { status: 400, body: { error: `Path is outside the workspace: ${path}` } };
  let info;
  try {
    info = await stat(abs);
  } catch {
    return { status: 404, body: { error: `No such workspace file: ${path}` } };
  }
  if (info.isDirectory()) return { status: 400, body: { error: "Cannot open a directory." } };
  await open(abs); // launches the OS default app; we don't wait on the child
  return { status: 200, body: { ok: true } };
});

// POST /api/workspace/mkdir { parent, name } -> create a folder inside files/.
// `parent` is "" for the workspace root. Non-recursive so a duplicate surfaces.
const handleWorkspaceMkdir = workspaceRoute(async ({ parent, name }) => {
  const clean = validWorkspaceName(name);
  if (!clean) return { status: 400, body: { error: "Invalid folder name." } };
  const parentStr = String(parent ?? "");
  if (!resolveWorkspacePath(parentStr)) return { status: 400, body: { error: "Parent is outside the workspace." } };
  const target = resolveWorkspacePath(childPath(parentStr, clean));
  if (!target) return { status: 400, body: { error: "Path is outside the workspace." } };
  try {
    await mkdir(target); // no recursive: EEXIST means it already exists
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return { status: 409, body: { error: `"${clean}" already exists.` } };
    }
    throw e;
  }
  return { status: 200, body: { ok: true } };
});

// POST /api/workspace/rename { path, name } -> rename a file/folder in place
// (same parent directory), to a new single-segment name. Sandboxed to files/.
const handleWorkspaceRename = workspaceRoute(async ({ path, name }) => {
  const clean = validWorkspaceName(name);
  if (!clean) return { status: 400, body: { error: "Invalid name." } };
  const abs = resolveWorkspacePath(String(path ?? ""));
  if (!abs || abs === WORKSPACE_DIR) return { status: 400, body: { error: "Cannot rename this item." } };
  try {
    await stat(abs);
  } catch {
    return { status: 404, body: { error: `No such item: ${path}` } };
  }
  const slash = String(path).lastIndexOf("/");
  const dir = slash >= 0 ? String(path).slice(0, slash) : "";
  const target = resolveWorkspacePath(childPath(dir, clean));
  if (!target) return { status: 400, body: { error: "Path is outside the workspace." } };
  if (target !== abs) {
    try {
      await stat(target);
      return { status: 409, body: { error: `"${clean}" already exists.` } };
    } catch {
      /* target free: proceed */
    }
  }
  await renameFs(abs, target);
  return { status: 200, body: { ok: true } };
});

// POST /api/workspace/remove { paths: string[] } -> delete files/folders inside
// files/ (folders recursively). Sandboxed: if any path escapes files/ or is the
// root, the whole batch is rejected. A missing path is ignored (force).
const handleWorkspaceRemove = workspaceRoute(async ({ paths }) => {
  const list = Array.isArray(paths) ? paths.map((p) => String(p)) : [];
  if (!list.length) return { status: 400, body: { error: "Nothing to remove." } };
  const targets: string[] = [];
  for (const p of list) {
    const abs = resolveWorkspacePath(p);
    if (!abs || abs === WORKSPACE_DIR) return { status: 400, body: { error: `Cannot remove: ${p}` } };
    targets.push(abs);
  }
  for (const abs of targets) await rm(abs, { recursive: true, force: true });
  return { status: 200, body: { ok: true, removed: targets.length } };
});

const WS_MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB per dropped file

// Pick a free workspace-relative path under `parent` for `name`, auto-renaming
// "file.ext" -> "file (1).ext", "file (2).ext"… on collision (Finder-style).
// Returns the absolute + relative path, or null if it escapes the sandbox.
async function uniqueChildPath(parent: string, name: string): Promise<{ abs: string; rel: string } | null> {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? name : `${base} (${n})${ext}`;
    const rel = childPath(parent, candidate);
    const abs = resolveWorkspacePath(rel);
    if (!abs || abs === WORKSPACE_DIR) return null;
    try {
      await stat(abs); // exists -> try the next suffix
    } catch {
      return { abs, rel }; // free
    }
  }
  return null;
}

// POST /api/workspace/upload?parent=<dir>&name=<file> with the raw file bytes as
// the body -> save a dropped file into files/. `parent` is "" for the root.
// Binary-safe (raw Buffer body), sandboxed, size-capped, and auto-renames on a
// name clash so a drop never overwrites or fails on duplicates.
async function handleWorkspaceUpload(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  if (req.method !== "POST") return next();
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const clean = validWorkspaceName(url.searchParams.get("name"));
    if (!clean) return sendJson(res, 400, { error: "Invalid file name." });
    const parent = url.searchParams.get("parent") ?? "";
    if (!resolveWorkspacePath(parent)) return sendJson(res, 400, { error: "Parent is outside the workspace." });
    const free = await uniqueChildPath(parent, clean);
    if (!free) return sendJson(res, 400, { error: "Path is outside the workspace." });
    let buf: Buffer;
    try {
      buf = await readRawBody(req, WS_MAX_UPLOAD);
    } catch (e) {
      if ((e as Error).message === "TOO_LARGE") {
        return sendJson(res, 413, { error: `File exceeds the ${prettyBytes(WS_MAX_UPLOAD)} limit.` });
      }
      throw e;
    }
    await writeFile(free.abs, buf);
    sendJson(res, 200, { ok: true, path: free.rel });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

// Content of one user turn: plain text, or text + image blocks (Anthropic
// MessageParam content). Loosely typed; the SDK message is a MessageParam.
type TurnContent = string | Array<Record<string, unknown>>;

// Explicit execution-mode hints, keyed by the same ids the client's EXEC_MODES
// uses (src/preview/execModes.ts). A picked mode prepends a directive to the turn
// so the user can invoke a flow explicitly instead of relying on inference. The
// "default" mode has no entry (no hint). Add a mode = add one entry here + there.
const EXEC_HINTS: Record<string, string> = {
  "fix-layout":
    "[execution mode: Fix Layout] Use the fix-layout skill on the active slide: " +
    "render and scan it (render_slide + geometry), find layout/formatting issues, " +
    "and fix them by editing deck.json / theme.json. Then re-render to verify.",
};

// Prepend a compact context header (and, if a mode is selected, its execution
// hint) to the user's turn so the agent always has minimal awareness (active
// slide, selection, any render issues) without having to call a tool. Full detail
// still comes from the `deck` MCP tools. When the Visual Selection tool attached a
// crop, ride it along as an image block so the agent sees the region beside the text.
async function composeTurn(message: string, image?: string, mode?: string, visual?: unknown): Promise<TurnContent> {
  const header = await contextHeader();
  const hint = mode ? EXEC_HINTS[mode] ?? "" : "";
  const region = formatVisualRegion(visual);
  // Always make the agent aware of the workspace structure (tree only, no
  // contents); it reads files on demand via the read_workspace_file tool.
  let workspace = "";
  try {
    workspace = workspaceManifest(await buildWorkspaceTree());
  } catch {
    /* workspace unreadable: skip the manifest */
  }
  const refs = await referencedFiles(message);
  const text = [header, workspace, refs, region, hint, message].filter(Boolean).join("\n\n");
  if (!image) return text;
  const data = image.replace(/^data:image\/\w+;base64,/, "");
  const note = region
    ? "(Attached: a crop of exactly the [visual region] above; use those coordinates even if the crop is blank.)"
    : "(Attached: a visual crop of the slide region the user selected; inspect it.)";
  return [
    { type: "text", text: `${text}\n\n${note}` },
    { type: "image", source: { type: "base64", media_type: "image/png", data } },
  ];
}

// Render a VisualRegion (from the client's selection box) as an explicit,
// agent-readable block: a one-line header, the structured JSON, and how to use
// it. Defensive about shape (the value is whatever the chat body carried).
function formatVisualRegion(visual: unknown): string {
  const v = visual as Partial<{
    canvas: { w: number; h: number };
    rect: { x: number; y: number; w: number; h: number };
    center: { x: number; y: number };
    zone: string;
  }> | null | undefined;
  const r = v?.rect;
  if (!r || typeof r.x !== "number" || typeof r.w !== "number") return "";
  const cw = v.canvas?.w ?? 13.333;
  const ch = v.canvas?.h ?? 7.5;
  const json = JSON.stringify({ rect: r, center: v.center, zone: v.zone });
  return (
    `[visual region] The user drew a selection box on the active slide. ` +
    `Units: inches, origin top-left, canvas ${cw}x${ch}in.\n${json}\n` +
    `Use these coordinates to place or edit elements there even if the crop looks blank.`
  );
}

// Resolve "@path" mentions in a user message (from the chat file picker) to an
// explicit, validated reference line so the agent points at the exact file or
// folder. Only paths that actually exist in the workspace survive, which drops
// false positives like email addresses or stray "@words".
async function referencedFiles(message: string): Promise<string> {
  const seen = new Set<string>();
  for (const m of message.matchAll(/(?:^|\s)@([\w./-]+)/g)) {
    const rel = m[1].replace(/[.,;:)]+$/, "").replace(/\/+$/, ""); // trim trailing punctuation / slash
    if (!rel || seen.has(rel)) continue;
    const abs = resolveWorkspacePath(rel);
    if (!abs || abs === WORKSPACE_DIR) continue;
    try {
      const st = await stat(abs);
      if (st.isFile() || st.isDirectory()) seen.add(rel);
    } catch {
      /* not a real workspace entry: ignore */
    }
  }
  if (!seen.size) return "";
  return `[referenced files] ${[...seen].join(", ")}`;
}

async function contextHeader(): Promise<string> {
  const id = uiContext.activeSlideId;
  if (!id) return "";
  let layout = "";
  let title = "";
  try {
    const deck = JSON.parse(await readFile(DECK_PATH, "utf8"));
    const slide = deck.slides.find((s: { id: string }) => s.id === id);
    if (slide) {
      layout = slide.layout ?? "";
      title = Array.isArray(slide.title) ? slide.title.map((s: { text: string }) => s.text).join("") : "";
    }
  } catch {
    /* deck unreadable: still report the id we have */
  }
  const sel = uiContext.selection?.length ? uiContext.selection.join(", ") : "none";
  const parts = [
    `active slide: ${id}${layout ? ` (${layout})` : ""}${title ? ` "${title}"` : ""}`,
    `selection: ${sel}`,
  ];
  const st = uiContext.selectedText;
  if (st?.text) {
    const snippet = st.text.length > 80 ? st.text.slice(0, 80) + "…" : st.text;
    parts.push(`text: "${snippet}" in ${st.elementKey}${st.path ? ` (${st.path})` : ""}`);
  }
  const issues = renderIssues();
  if (issues) parts.push(issues);
  return `[context] ${parts.join("; ")}`;
}

// Terse one-liner of rendered-layout problems the browser measured, or "" if none.
function renderIssues(): string {
  const r = uiContext.render;
  if (!r) return "";
  const msgs: string[] = [];
  for (const [key, f] of Object.entries(r)) {
    if (f.overflowLines) msgs.push(`${key} overflows ~${f.overflowLines} line(s)`);
    else if (f.overflowInches) msgs.push(`${key} overflows ~${f.overflowInches}in`);
    if (f.offCanvas) msgs.push(`${key} off-canvas`);
  }
  return msgs.length ? `issues: ${msgs.join(", ")}` : "";
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

// ---------------------------------------------------------------------------
// In-process MCP server: gives the agent on-demand read access to the LIVE
// editor (active slide + resolved geometry, selection, design tokens). Geometry
// is computed by the same resolveSlide engine the preview and exporter use,
// loaded through Vite's transform pipeline (like the export route).
// ---------------------------------------------------------------------------

type ToolText = { content: { type: "text"; text: string }[] };
const textResult = (obj: unknown): ToolText => ({
  content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
});

// An image tool result the model can view. `dataUrl` is a PNG data URL from the
// client capture; strip the prefix to the bare base64 the MCP image block wants.
type ToolImage = { content: { type: "image"; data: string; mimeType: string }[] };
const imageResult = (dataUrl: string): ToolImage => ({
  content: [{ type: "image", data: dataUrl.replace(/^data:image\/\w+;base64,/, ""), mimeType: "image/png" }],
});

// Resolve a slide to positioned Elements (inches) via the shared layout engine.
async function resolveElements(slide: unknown, footer: string): Promise<unknown[]> {
  if (!devServer) return [];
  const mod = (await devServer.ssrLoadModule("/src/layout/resolve.ts")) as {
    resolveSlide: (s: unknown, t: unknown, f: string) => unknown[];
  };
  const theme = JSON.parse(await readFile(THEME_PATH, "utf8"));
  return mod.resolveSlide(slide, theme, footer);
}

async function loadDeck(): Promise<any> {
  return JSON.parse(await readFile(DECK_PATH, "utf8"));
}

function activeSlide(deck: any): any {
  return deck.slides.find((s: { id: string }) => s.id === uiContext.activeSlideId);
}

const deckMcp = createSdkMcpServer({
  name: "deck",
  version: "1.0.0",
  instructions:
    "Inspect the live slide editor: the active slide with resolved geometry, the " +
    "current selection, and the design system. Use render_slide to actually SEE the " +
    "slide as a rendered image. Read-only; edit deck.json to change slides.",
  tools: [
    tool(
      "get_active_slide",
      "The slide the user is currently viewing: its full JSON plus resolved elements (positions/sizes in inches) and any measured render issues (overflow / off-canvas).",
      {},
      async () => {
        const deck = await loadDeck();
        const slide = activeSlide(deck) ?? deck.slides[0];
        if (!slide) return textResult({ error: "deck has no slides" });
        const elements = await resolveElements(slide, deck.meta?.footer ?? "");
        return textResult({
          activeSlideId: slide.id,
          layout: slide.layout,
          slide,
          elements,
          render: uiContext.render ?? {},
        });
      },
    ),
    tool(
      "get_selection",
      "What the user has selected for context with the Selection tool: the element(s) (each with resolved geometry + any render issue) and, when present, the exact selected text range (substring, the element + deck field it is in, and char offsets). Empty when nothing is selected.",
      {},
      async () => {
        const keys = uiContext.selection ?? [];
        const deck = await loadDeck();
        const slide = activeSlide(deck);
        const elements = slide ? await resolveElements(slide, deck.meta?.footer ?? "") : [];
        const items = keys.map((key) => ({
          key,
          element: (elements as { key?: string }[]).find((e) => e.key === key) ?? null,
          render: uiContext.render?.[key] ?? null,
        }));
        return textResult({
          activeSlideId: uiContext.activeSlideId,
          selection: keys,
          selectedText: uiContext.selectedText ?? null,
          items,
        });
      },
    ),
    tool(
      "get_design_system",
      "The current visual design tokens (theme.json: colors, fonts, type sizes, margins, layout spacing). The full spec prose lives in design/DESIGN.md.",
      {},
      async () => {
        const theme = JSON.parse(await readFile(THEME_PATH, "utf8"));
        return textResult({ theme, spec: "design/DESIGN.md" });
      },
    ),
    tool(
      "render_slide",
      "Render the slide the user is currently viewing to an image and look at it. Returns a pixel-faithful PNG of the live preview (the same fonts/layout the user sees). Use this to judge visual problems geometry alone can't show: overlaps, cut-off text, low contrast, uneven spacing, misalignment. Re-call after an edit to verify the fix.",
      {},
      async () => {
        const dataUrl = await claude.requestClientRender();
        if (!dataUrl) {
          return textResult({ error: "Couldn't capture the slide - is the preview open in the browser?" });
        }
        return imageResult(dataUrl);
      },
    ),
    tool(
      "list_workspace",
      "List the workspace (the files/ directory): the full file tree with metadata (name, type, size, modified time). The agent is already given a compact version of this each turn; call this when you want the complete, current tree.",
      {},
      async () => {
        const tree = await buildWorkspaceTree();
        return textResult(tree);
      },
    ),
    tool(
      "read_workspace_file",
      "Read one file from the workspace (files/) by its relative path (e.g. \"notes/example.md\"). Text files return their text; images return a viewable image. Use this only when you actually need a file's contents - the tree alone is given to you every turn.",
      { path: z.string().describe("Path relative to the files/ workspace directory, e.g. \"notes/example.md\".") },
      async ({ path }) => {
        const abs = resolveWorkspacePath(path);
        if (!abs) return textResult({ error: `Path is outside the workspace: ${path}` });
        let info;
        try {
          info = await stat(abs);
        } catch {
          return textResult({ error: `No such workspace file: ${path}` });
        }
        if (info.isDirectory()) return textResult({ error: `${path} is a directory; use list_workspace.` });
        // Anthropic image blocks only accept these media types; mime-types maps the
        // extension. Any other image (e.g. svg) falls through to the text path.
        const mime = String(mimeTypes.lookup(path) || "");
        const SUPPORTED_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
        if (SUPPORTED_IMAGE.has(mime)) {
          const b64 = (await readFile(abs)).toString("base64");
          return { content: [{ type: "image" as const, data: b64, mimeType: mime }] };
        }
        const MAX_TEXT = 200_000; // ~200KB cap; bigger/binary files aren't dumped
        if (info.size > MAX_TEXT) {
          return textResult({ error: `${path} is ${prettyBytes(info.size)}; too large to read inline.` });
        }
        const buf = await readFile(abs);
        if (isBinary(path, buf)) return textResult({ error: `${path} looks binary; not shown.` });
        return textResult({ path, size: info.size, content: buf.toString("utf8") });
      },
    ),
  ],
});

// Pending render requests keyed by id: the render_slide tool parks a promise here
// and the browser resolves it via POST /api/render-result with the captured PNG.
const pendingRenders = new Map<string, { resolve: (v: string | null) => void; timer: ReturnType<typeof setTimeout> }>();
const RENDER_TIMEOUT_MS = 8000;

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

  runTurn(content: TurnContent, res: ServerResponse): Promise<void> {
    const turn = this.queue.then(() => this.execTurn(content, res));
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

  private execTurn(content: TurnContent, res: ServerResponse): Promise<void> {
    this.ensureStarted();
    return new Promise<void>((resolve) => {
      this.activeRes = res;
      this.endTurn = () => {
        this.activeRes = undefined;
        this.endTurn = undefined;
        resolve();
      };
      this.input!.push(content);
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
        // Specialize the agent: Claude Code base (keeps file-edit skill + auto-loads
        // project CLAUDE.md) reframed for slide authoring by the appended brief.
        systemPrompt: { type: "preset", preset: "claude_code", append: AGENT_BRIEF },
        // Isolation: load only project settings + CLAUDE.md (not user/local
        // settings.json). 'project' is required for any CLAUDE.md to load at all.
        settingSources: ["project"],
        // ...but enabling CLAUDE.md loads the full user+project memory hierarchy,
        // so drop the user-global file by path. Keeps the project CLAUDE.md.
        settings: { claudeMdExcludes: [USER_CLAUDE_MD] },
        // Use only our in-process tools; ignore any stray .mcp.json / user MCP.
        strictMcpConfig: true,
        disallowedTools: ["WebFetch", "WebSearch"],
        mcpServers: { deck: deckMcp },
        // Repo-bundled skills under .claude/skills/. Explicit list (not 'all') so
        // only project skills load - a user-scope skill can't leak in.
        skills: ["fix-layout"],
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

  // Ask the browser to rasterize the slide it is showing and send the PNG back.
  // Emits a `render-request` SSE event on the active turn's stream; the client
  // POSTs to /api/render-result, which resolves the parked promise. Resolves null
  // if no turn is live or the client doesn't answer within the timeout.
  requestClientRender(): Promise<string | null> {
    if (!this.activeRes) return Promise.resolve(null);
    const requestId = `r${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        pendingRenders.delete(requestId);
        resolve(null);
      }, RENDER_TIMEOUT_MS);
      pendingRenders.set(requestId, { resolve, timer });
      this.send("render-request", JSON.stringify({ requestId }));
    });
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
  push: (content: TurnContent) => void;
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
    push(content) {
      const msg = {
        type: "user",
        message: { role: "user", content },
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

// Binary-safe request body reader (Buffer chunks, not string concat), aborting
// once `maxBytes` is exceeded. Used for file uploads; rejects with "TOO_LARGE".
function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return; // already rejected; drain the rest so the response can flush
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        req.resume(); // discard remaining bytes without tearing down the socket
        reject(new Error("TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
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
