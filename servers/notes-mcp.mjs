#!/usr/bin/env node
/**
 * 笔记后端：本地 SQLite 的 stdio MCP server。
 *
 * DSH 的 MCP bridge 会把这个脚本作为**本地 stdio MCP server** 启动；
 * 工具随之以 `mcp__pa__<name>` 暴露给 agent。
 *
 * 设计要点：
 *   - 零依赖：只用 `node:sqlite`（Node 22.5+ / 24 内置），无需 better-sqlite3。
 *   - 纯本地：数据只落 `PA_NOTE_STORE` 指向的 sqlite 文件，不出网。
 *   - 协议：MCP over stdio，逐行 JSON-RPC 2.0。
 *
 * 环境变量：
 *   PA_NOTE_STORE  笔记库路径（默认 ~/.dsh/storages/pa-notes.sqlite）
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// node:sqlite 在 Node 22.5+ 存在，但 Node 22 上可能仍需要 --experimental-sqlite；
// Node 24+ 无需 flag。DSH Desktop 内置 Node 24，因此正常可用。
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  process.stderr.write(
    `[pa-notes] 无法加载 node:sqlite（需要 Node >= 24）：${error.message}\n`,
  );
  process.exit(1);
}

const SERVER_NAME = "pa-notes";
const SERVER_VERSION = "0.1.0";
/** 支持的 MCP 协议版本；回显客户端请求的版本（若在列表内），否则给最新。 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const MAX_CONTENT_CHARS = 20000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

// ---------------------------------------------------------------- 存储层

function resolveStorePath() {
  const fromEnv = process.env.PA_NOTE_STORE;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return join(homedir(), ".dsh", "storages", "pa-notes.sqlite");
}

let db;

function openDb() {
  if (db) return db;
  const path = resolveStorePath();
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
  `);
  return db;
}

/** tags 统一用 `,kw1,kw2,` 存储，便于 LIKE 精确匹配单个标签。 */
function normalizeTags(tags) {
  if (!tags) return "";
  const list = (Array.isArray(tags) ? tags : String(tags).split(/[,，\s]+/))
    .map(t => String(t).trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.length ? `,${out.join(",")},` : "";
}

function createNote({ content, tags }) {
  const text = String(content ?? "").trim();
  if (!text) throw new Error("content 不能为空");
  if (text.length > MAX_CONTENT_CHARS) {
    throw new Error(`content 超长（${text.length} > ${MAX_CONTENT_CHARS}）`);
  }
  const now = Date.now();
  const id = randomUUID();
  openDb()
    .prepare(
      "INSERT INTO notes (id, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, text, normalizeTags(tags), now, now);
  return { id, content: text, createdAt: now };
}

function searchNotes({ query, limit }) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("query 不能为空");
  const n = clampLimit(limit);
  const like = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`;
  const rows = openDb()
    .prepare(
      `SELECT id, content, tags, created_at
         FROM notes
        WHERE content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(like, like, n);
  return rows.map(rowToNote);
}

function listNotes({ limit }) {
  const n = clampLimit(limit);
  const rows = openDb()
    .prepare(
      "SELECT id, content, tags, created_at FROM notes ORDER BY created_at DESC LIMIT ?",
    )
    .all(n);
  return rows.map(rowToNote);
}

function deleteNote({ id }) {
  const key = String(id ?? "").trim();
  if (!key) throw new Error("id 不能为空");
  const info = openDb().prepare("DELETE FROM notes WHERE id = ?").run(key);
  return { id: key, deleted: info.changes > 0 };
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function rowToNote(row) {
  return {
    id: row.id,
    content: row.content,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    createdAt: Number(row.created_at),
  };
}

// ---------------------------------------------------------------- 工具定义

const TOOLS = [
  {
    name: "note_create",
    description:
      "保存一条速记/笔记到本地笔记库。用户说「记一下…」「帮我记着…」时使用。",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "笔记正文（自然语言，允许 Markdown）" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "可选标签，便于后续检索",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "note_search",
    description: "按关键词检索本地笔记（匹配正文与标签）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词" },
        limit: { type: "integer", description: "最多返回条数，默认 20，上限 200" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "note_list",
    description: "列出最近的笔记（按时间倒序）。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "最多返回条数，默认 20，上限 200" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "note_delete",
    description: "删除一条笔记。属于写操作，调用前必须先向用户确认。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "note id" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

const HANDLERS = {
  note_create: createNote,
  note_search: searchNotes,
  note_list: listNotes,
  note_delete: deleteNote,
};

// ---------------------------------------------------------------- MCP 协议

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : DEFAULT_PROTOCOL_VERSION;
}

async function handleRequest(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const handler = HANDLERS[name];
      if (!handler) {
        return {
          content: [{ type: "text", text: `未知工具: ${name}` }],
          isError: true,
        };
      }
      try {
        const payload = handler(params?.arguments ?? {});
        return { content: [{ type: "text", text: render(payload) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `工具执行失败: ${error.message}` }],
          isError: true,
        };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

/** 工具结果统一渲染成人类/模型都可读的文本。 */
function render(payload) {
  if (payload == null) return "ok";
  if (Array.isArray(payload)) {
    if (payload.length === 0) return "（无结果）";
    return payload
      .map(n => `- [${new Date(n.createdAt).toISOString()}] (${n.id})\n  ${n.content}`)
      .join("\n");
  }
  return JSON.stringify(payload, null, 2);
}

function handleLine(line) {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return; // 非法 JSON：MCP 无 id 可回，直接忽略
  }
  // 通知（无 id）不需要响应
  if (message.id === undefined || message.id === null) return;
  const { id, method, params } = message;
  handleRequest(method, params)
    .then(result => reply(id, result))
    .catch(error => replyError(id, error.code ?? -32603, error.message));
}

function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  });
  process.stdin.on("end", () => {
    if (buffer.trim()) handleLine(buffer);
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  });
}

main();
