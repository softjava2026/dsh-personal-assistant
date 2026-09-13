/**
 * 个人助手运行时：编排核心 + 主动智能。
 *
 * 主动智能（M1 已实现）：
 *   在 `agent/pre-step` 里注入一条**每日摘要**（今日日程 / 逾期待办 / 最近笔记）。
 *   纪律：
 *     - **每个会话每天只注入一次**（内存缓存 + 历史去重双保险）
 *     - 构造带 `source: { kind:'plugin', form:'proactive-digest' }` 的**可回放**消息
 *     - 任何失败都静默降级为「不注入」，绝不拖垮正常对话
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";

import { PLUGIN_SOURCE, resolveNoteStorePath } from "./config.mjs";
import { collectDigest, formatDigest } from "./digest.mjs";

/** 注入消息的 form 标识（与 source.plugin 一起用于历史去重）。 */
const DIGEST_FORM = "proactive-digest";

/** 本地日期键，形如 `2026-09-13`；同时作为注入文本里的去重标记。 */
function dayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class PersonalAssistantRuntime {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    /** sessionId -> { day: string, text: string|null, injected: boolean } */
    this.digests = new Map();
  }

  /**
   * 主动上下文注入。
   *
   * 返回 `null` = 本次不注入；返回 `[message]` = 追加到本步的用户消息之后。
   */
  async proactiveContext(agent, _messages) {
    if (!this.config.proactiveEnabled || !this.config.dailyDigestEnabled) return null;
    try {
      return await this.#dailyDigest(agent);
    } catch (error) {
      this.logger?.warn?.(`[personal-assistant] proactiveContext failed: ${error?.message}`);
      return null;
    }
  }

  async #dailyDigest(agent) {
    const sessionId = agent?.session?.id ?? "default";
    const today = dayKey();

    // ① 历史里已经有今天的摘要 → 直接跳过（跨插件重载也成立）
    if (hasDigestInHistory(agent, today)) {
      this.digests.set(sessionId, { day: today, text: null, injected: true });
      return null;
    }

    const state = this.digests.get(sessionId);
    // ② 本会话今天已注入过
    if (state?.day === today && state.injected) return null;

    // ③ 今天还没采集过 → 采集（多来源，任一失败不影响其它）
    let text = state?.day === today ? state.text : null;
    if (state?.day !== today) {
      const sections = await collectDigest(this.config, {
        resolveStorePath: resolveNoteStorePath,
        logger: this.logger,
      });
      const budgetChars = Math.max(200, Number(this.config.proactiveTokenBudget || 800) * 3);
      text = formatDigest(sections, budgetChars, today);
      this.logger?.info?.(
        `[personal-assistant] digest collected: ${sections.length} source(s), ${text ? text.length : 0} chars`,
      );
    }

    // ④ 没内容就标记为已处理，不再重复尝试
    if (!text) {
      this.digests.set(sessionId, { day: today, text: null, injected: true });
      return null;
    }

    this.digests.set(sessionId, { day: today, text, injected: true });
    return [
      createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "plugin", plugin: PLUGIN_SOURCE, form: DIGEST_FORM },
      }),
    ];
  }

  dispose() {
    this.digests.clear();
  }
}

/** 历史事件 / 待处理队列里是否已有今天注入的摘要。 */
function hasDigestInHistory(agent, today) {
  const session = agent?.session;
  const events = (session?.events || []).slice(session?.header?.seedLength ?? 0);
  if (events.some(event => event?.type === "user/message" && isTodayDigest(event.data, today))) {
    return true;
  }
  const queues = [agent?.inbox?.nextTurn, agent?.inbox?.nextStep];
  return queues.some(list => (list || []).some(message => isTodayDigest(message, today)));
}

function isTodayDigest(message, today) {
  const source = message?.source;
  if (source?.kind !== "plugin") return false;
  if (source.plugin !== PLUGIN_SOURCE) return false;
  if (source.form !== DIGEST_FORM) return false;
  const text = (message.content || []).map(part => part?.text || "").join("");
  return text.includes(today);
}
