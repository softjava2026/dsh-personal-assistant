/**
 * 插件契约冒烟测试：用 mock ctx 调 apply()，验证四处注册都发生。
 *
 * 需要 peer 依赖可解析。本地跑法（临时把 DSH 的依赖目录挂进来）：
 *   ln -s ~/.dsh/profiles/desktop/node_modules ./node_modules   # Windows: mklink /D
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop" test/apply.smoke.mjs
 *   rm ./node_modules
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply, inject, name } from "../index.mjs";

const record = { provided: [], effects: [], hooks: [], plugins: [] };

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  provide(key, value) {
    record.provided.push(key);
    ctx._runtime = value;
  },
  effect(_fn, label) {
    record.effects.push(label);
  },
  on(event, _handler, _opts) {
    record.hooks.push(event);
  },
  plugin(_module, config = {}) {
    record.plugins.push(config.serverName ?? config.providerName ?? "(anonymous)");
    return {};
  },
};

// 用系统临时目录，而不是硬编码 /tmp —— 后者在 Windows 上会落到当前盘根目录。
apply(ctx, { noteStorePath: join(tmpdir(), "pa-apply-test.sqlite") });

const checks = [
  ["插件名", name === "personal-assistant"],
  ["inject 声明", Array.isArray(inject) && inject.includes("agents")],
  ["注册 personalAssistant 服务", record.provided.includes("personalAssistant")],
  ["注册 dispose effect", record.effects.length === 1],
  ["挂 agent/session-start 钩子", record.hooks.includes("agent/session-start")],
  ["挂 agent/pre-step 钩子", record.hooks.includes("agent/pre-step")],
  ["挂载 skill provider", record.plugins.includes("personal-assistant")],
  ["挂载 MCP server", record.plugins.includes("pa")],
  ["runtime 有 proactiveContext", typeof ctx._runtime?.proactiveContext === "function"],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failed += 1;
}
console.log(`\n  provided=${JSON.stringify(record.provided)}`);
console.log(`  hooks=${JSON.stringify(record.hooks)}`);
console.log(`  plugins=${JSON.stringify(record.plugins)}`);

if (failed > 0) {
  console.error(`\n❌ apply smoke FAILED (${failed})`);
  process.exit(1);
}
console.log("\n✅ apply smoke OK");
