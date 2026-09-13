/**
 * dsh-personal-assistant — 个人智慧助手 bundle 入口。
 *
 * 导出 Cordis 插件契约：{ name, inject, apply(ctx, input) }。
 * 结构对齐 @openviking/dsh-memory-plugin（同为 DSH bundle）。
 *
 * 编排职责：
 *   1. 提供 `personalAssistant` 服务（runtime）
 *   2. 会话开始注入助手画像（M1 实现）
 *   3. `agent/pre-step` 注入主动上下文（每日摘要/逾期待办/场景提醒）
 *   4. 挂载隔离的 `personal-assistant` skill（本 bundle 自带）
 *   5. 笔记后端 MCP 工具面（M1 就绪后启用，见 mcp.mjs）
 */
import { resolveConfig } from "./config.mjs";
import { mountNotesMcp } from "./mcp.mjs";
import { PersonalAssistantRuntime } from "./runtime.mjs";
import { mountPersonalAssistantSkills } from "./skills.mjs";

export const name = "personal-assistant";
export const inject = ["agents", "sessions", "tools"];

export function apply(ctx, input = {}) {
  const config = resolveConfig(input);
  const runtime = new PersonalAssistantRuntime(config, ctx.logger);

  // 注册服务（isolate 键名需与此一致）
  ctx.provide("personalAssistant", runtime);
  ctx.effect(
    () => () => runtime.dispose(),
    "personalAssistant.dispose()",
  );

  // 会话开始：注入助手画像（TODO(M1)：真实画像，参考 openviking 的
  // `agent.inject()` 而非改 system prompt，避免被 preset 覆盖）
  ctx.on("agent/session-start", ({ agent }) => {
    ctx.logger?.info?.("[personal-assistant] session-start", { id: agent.session?.id });
    return true;
  });

  // 主动智能：沿用 openviking 的 pre-step 瀑布注入模式（prepend 保证
  // 看到最终上下文批次后追加；不用 system prompt，理由同上）
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
    const decision = await next();
    if (decision.kind !== "enter" || signal.aborted) return decision;
    const additions = await runtime.proactiveContext(agent, decision.messages);
    if (!additions || additions.length === 0) return decision;
    return { kind: "enter", messages: [...decision.messages, ...additions] };
  }, { prepend: true });

  // skill 挂载（与 openviking 一致）
  mountPersonalAssistantSkills(ctx);

  // MCP 桥最后挂，且刻意不 await：桥的 apply 会阻塞在首次 tools/list 上，
  // 一个接受连接却不回应的 server 会拖住上面所有注册。
  mountNotesMcp(ctx, config);
}
