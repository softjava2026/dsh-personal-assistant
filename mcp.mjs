/**
 * 笔记后端 MCP 工具面。
 *
 * 本地 SQLite（`node:sqlite`）+ stdio MCP server，工具以 `mcp__pa__*` 暴露：
 *   pa__note_create / pa__note_search / pa__note_list / pa__note_delete
 *
 * 为什么用 stdio 而不是进程内直接调：
 *   与 @openviking/dsh-memory-plugin 对齐 —— 走 dsh-mcp-client 的 stdio 桥，
 *   工具面由 host 统一注册、统一鉴权，插件本身不碰工具注册内部结构。
 *
 * DSH Desktop 下 `process.execPath` 是 Electron 可执行文件，必须带
 * `ELECTRON_RUN_AS_NODE=1`，否则会试图再开一个 Desktop 实例。
 */
import { fileURLToPath } from "node:url";

import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

import { MCP_SERVER_NAME, resolveNoteStorePath } from "./config.mjs";

/** 随本 bundle 一起发布的 stdio MCP server 脚本。 */
export const NOTES_SERVER_PATH = fileURLToPath(
  new URL("./servers/notes-mcp.mjs", import.meta.url),
);

export function buildMcpConfig(config) {
  return {
    transport: "stdio",
    serverName: MCP_SERVER_NAME,
    command: process.execPath,
    args: [NOTES_SERVER_PATH],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      PA_NOTE_STORE: resolveNoteStorePath(config),
    },
  };
}

export function mountNotesMcp(ctx, config) {
  return ctx.plugin(mcpClient, buildMcpConfig(config));
}

export { MCP_SERVER_NAME };
