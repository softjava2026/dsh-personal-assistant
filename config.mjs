/**
 * 配置解析与常量。
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** 与 package.json 的 version 保持一致（`npm run check` 会校验）。 */
export const PLUGIN_VERSION = "0.1.0";

/** 本插件注入消息的 source 标识，用于历史去重与回放识别。 */
export const PLUGIN_SOURCE = "dsh-personal-assistant";

/** 本 bundle 的 skill provider 名；不能与 DSH 默认 `filesystem` 冲突。 */
export const SKILL_PROVIDER_NAME = "personal-assistant";

/** MCP server 名；决定工具名 `mcp__pa__<rawName>`。 */
export const MCP_SERVER_NAME = "pa";

const DEFAULT_CONFIG = Object.freeze({
  // 笔记存储路径；null = 默认 ~/.dsh/storages/pa-notes.sqlite
  noteStorePath: null,
  // 主动智能开关
  proactiveEnabled: true,
  dailyDigestEnabled: true,
  // 主动上下文 token 预算（控制注入量，避免挤占用户上下文）
  proactiveTokenBudget: 800,

  // ---- 主动摘要的来源开关（任一失败不影响其它来源）----
  digestIncludeCalendar: true,
  digestIncludeTodo: true,
  digestIncludeNotes: true,

  // ---- dws（钉钉）命令；dws 未安装时会被自动跳过 ----
  // 注意：参数形状需按本机 `dws --help` 校对后再启用。
  dwsBin: "dws",
  dwsCalendarArgs: ["calendar", "list", "--date", "today", "--json"],
  dwsTodoArgs: ["todo", "list", "--status", "open", "--json"],
});

export function resolveConfig(input = {}) {
  return { ...DEFAULT_CONFIG, ...input };
}

/** 笔记库绝对路径；配置优先，否则落到 DSH 默认 storages 目录。 */
export function resolveNoteStorePath(config = {}) {
  const custom = config.noteStorePath;
  if (custom && String(custom).trim()) return String(custom).trim();
  return join(homedir(), ".dsh", "storages", "pa-notes.sqlite");
}
