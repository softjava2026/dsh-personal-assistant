/**
 * 主动摘要（每日摘要）的采集与格式化。
 *
 * 设计原则：
 *   1. **多源可插拔**：每个来源独立、可失败。任何一个挂掉都不影响其它来源，
 *      全挂就返回空 —— 主动注入绝不拖垮正常对话。
 *   2. **本地优先**：笔记源直接读本 bundle 自己的 SQLite，永远可用；
 *      dws 源（日程/待办）在 `dws` 未安装时自动跳过。
 *   3. **有界**：输出按字符预算截断，避免挤占用户上下文。
 */
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const DWS_TIMEOUT_MS = 4000;

// ------------------------------------------------------------------ dws 源

/** 跑一条 dws 命令；失败/超时/未安装一律返回 null，不抛。 */
function runDws(bin, args, timeoutMs = DWS_TIMEOUT_MS) {
  return new Promise(resolve => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(String(stdout || ""));
    });
  });
}

/** dws 的 JSON 输出可能被日志包裹；尽量从尾部解析出 JSON 数组/对象。 */
function parseLooseJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf("[")), trimmed.slice(trimmed.indexOf("{"))]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["items", "data", "list", "result", "records"]) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

/** 今日日程（dws 未安装 → 空）。 */
async function collectCalendar(config) {
  if (!config.digestIncludeCalendar) return null;
  const raw = await runDws(config.dwsBin, config.dwsCalendarArgs);
  if (raw == null) return null;
  const items = asArray(parseLooseJson(raw));
  if (items.length === 0) return { title: "今日日程", lines: ["（今天没有日程）"] };
  const lines = items.slice(0, 8).map(item => {
    const time = item.startTime || item.start || item.time || "";
    const title = item.title || item.subject || item.summary || "(无标题)";
    return time ? `${time} ${title}` : String(title);
  });
  return { title: "今日日程", lines };
}

/** 未完成 / 逾期待办。 */
async function collectTodo(config) {
  if (!config.digestIncludeTodo) return null;
  const raw = await runDws(config.dwsBin, config.dwsTodoArgs);
  if (raw == null) return null;
  const items = asArray(parseLooseJson(raw));
  if (items.length === 0) return null;
  const now = Date.now();
  const overdue = [];
  const open = [];
  for (const item of items.slice(0, 30)) {
    const title = item.title || item.subject || item.content || "(无标题)";
    const due = item.dueTime || item.due || item.deadline;
    const dueMs = due ? Date.parse(due) : NaN;
    if (Number.isFinite(dueMs) && dueMs < now) overdue.push(`${title}（已逾期）`);
    else open.push(String(title));
  }
  const lines = [...overdue.slice(0, 5), ...open.slice(0, 5)];
  if (lines.length === 0) return null;
  return { title: overdue.length ? `待办（${overdue.length} 项逾期）` : "待办", lines };
}

// ----------------------------------------------------------------- 笔记源

/** 直接读本 bundle 自己的笔记库；库不存在/为空则返回 null。 */
function collectNotes(config, resolveStorePath) {
  if (!config.digestIncludeNotes) return null;
  const path = resolveStorePath(config);
  if (!existsSync(path)) return null;
  let db;
  try {
    db = new DatabaseSync(path);
    const rows = db
      .prepare("SELECT content, created_at FROM notes ORDER BY created_at DESC LIMIT 5")
      .all();
    if (rows.length === 0) return null;
    const lines = rows.map(row => {
      const text = String(row.content).replace(/\s+/g, " ").trim();
      return text.length > 60 ? `${text.slice(0, 59)}…` : text;
    });
    return { title: "最近笔记", lines };
  } catch {
    return null; // 读不到就当没这个源
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ 入口

/**
 * 采集全部可用来源。
 * @returns {Promise<Array<{title: string, lines: string[]}>>} 可能为空数组
 */
export async function collectDigest(config, { resolveStorePath, logger } = {}) {
  const tasks = [
    collectCalendar(config).catch(() => null),
    collectTodo(config).catch(() => null),
  ];
  const sections = (await Promise.all(tasks)).filter(Boolean);
  try {
    const notes = collectNotes(config, resolveStorePath);
    if (notes) sections.push(notes);
  } catch (error) {
    logger?.warn?.(`[personal-assistant] notes digest failed: ${error.message}`);
  }
  return sections;
}

/**
 * 把来源渲染成一段注入文本，并按预算截断。
 * @param {number} budgetChars 字符预算（token 预算按 ~3 字符/token 折算）
 * @param {string} day 日期标签（同时是历史去重用的标记）
 */
export function formatDigest(sections, budgetChars, day = "") {
  if (!sections || sections.length === 0) return null;
  const stamp = day ? `（${day}）` : "";
  const head = `【助手主动摘要】${stamp}以下是稍早采集的上下文，回答相关问题时可直接使用，不必重新查询：`;
  const body = sections
    .map(section => `${section.title}：\n${section.lines.map(l => `  · ${l}`).join("\n")}`)
    .join("\n");
  const full = `${head}\n${body}`;
  if (full.length <= budgetChars) return full;
  const cut = full.slice(0, Math.max(0, budgetChars - 1)).replace(/\s+\S*$/, "");
  return `${cut}…`;
}
