# dsh-personal-assistant

个人智慧助手 bundle for DeepSeek Harness（DSH）。

它不重新实现各能力，而是作为**编排层**：把 DSH 上已有的记忆（OpenViking）、日程/待办/提醒（钉钉 `dws`）串成"一个助手"，并自建笔记后端与主动智能。

## 现状

### ✅ M0 — 骨架
- 可被 `dsh plugin add` 加载的完整 bundle 结构
- 注册 `personalAssistant` 服务 + `agent/pre-step` 主动上下文钩子
- 隔离挂载 `personal-assistant` skill（SKILL.md + references）

### ✅ M1 — 单点打通
- **笔记后端 MCP**：`servers/notes-mcp.mjs`（`node:sqlite`，零依赖，纯本地）
  - 工具：`note_create` / `note_search` / `note_list` / `note_delete`
  - 以 `mcp__pa__*` 暴露给 agent
- **主动摘要注入**：`digest.mjs` 多源采集（今日日程 / 逾期待办 / 最近笔记），
  经 `runtime.mjs` 的 `proactiveContext()` 注入
  - **每会话每天只注入一次**（内存缓存 + 历史去重）
  - 带 `source: { kind:'plugin', form:'proactive-digest' }` 的**可回放**消息
  - 任一来源失败 → 静默降级，绝不拖垮对话

## 目录结构

```
dsh-personal-assistant/
├── package.json          # type:module + dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml      # 插件组声明（isolate: personalAssistant + config）
├── index.mjs             # 入口：export { name, inject, apply(ctx, input) }
├── config.mjs            # 常量 + 默认配置解析
├── runtime.mjs           # 编排核心 + 主动注入（proactiveContext）
├── digest.mjs            # 主动摘要采集 + 格式化（多源可插拔）
├── skills.mjs            # 隔离挂载 skill provider
├── mcp.mjs               # 笔记后端 MCP 客户端配置
├── servers/
│   └── notes-mcp.mjs     # 本地 SQLite 的 stdio MCP server
├── skills/
│   └── personal-assistant/
│       ├── SKILL.md              # skill 定义（name/description/路由）
│       └── references/
│           ├── routing.md        # 意图 → 能力路由表
│           └── safety.md         # 安全契约（确认/不编造/隐私）
├── test/
│   ├── notes-mcp.input.jsonl   # MCP 协议冒烟输入
│   ├── digest.smoke.mjs        # 摘要冒烟测试
│   └── apply.smoke.mjs         # 插件契约冒烟（需 DSH peer 依赖）
├── .github/workflows/ci.yml    # CI：语法检查 + 两项冒烟
├── .gitignore
├── CHANGELOG.md
├── LICENSE                     # MIT
├── PUBLISHING.md               # 发布清单（含 dsh-plugin topic 步骤）
└── README.md / README.en.md
```

## 安装

```bash
# 方式一：DSH CLI（内部走 pnpm，本地路径需先装好自身 node_modules）
dsh plugin --profile desktop add ./dsh-personal-assistant

# 方式二：手动加入 profile
# 编辑 ~/.dsh/profiles/desktop/package.json：
#   "dependencies": { "dsh-personal-assistant": "file:/绝对路径/dsh-personal-assistant" }
#   "dsh.profile.bundles": [..., "dsh-personal-assistant"]

# 验证
dsh --profile desktop --dump-config   # 应出现 personal-assistant 插件组
```

> 依赖 peer 包（`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-skill-filesystem`）由 DSH 自身提供，本包无需自带。

## 配置（`cordis.patch.yml`）

| 键 | 默认 | 说明 |
|---|---|---|
| `noteStorePath` | `null` → `~/.dsh/storages/pa-notes.sqlite` | 笔记库路径 |
| `proactiveEnabled` | `true` | 主动智能总开关 |
| `dailyDigestEnabled` | `true` | 每日摘要开关 |
| `proactiveTokenBudget` | `800` | 注入预算（按 ~3 字符/token 折算）|
| `digestIncludeCalendar` | `true` | 摘要来源：今日日程（需 `dws`）|
| `digestIncludeTodo` | `true` | 摘要来源：待办（需 `dws`）|
| `digestIncludeNotes` | `true` | 摘要来源：最近笔记（本地，恒可用）|
| `dwsBin` | `"dws"` | dws 可执行文件；缺失时该来源自动跳过 |
| `dwsCalendarArgs` | `["calendar","list","--date","today","--json"]` | ⚠️ 需按本机 `dws --help` 校对 |
| `dwsTodoArgs` | `["todo","list","--status","open","--json"]` | ⚠️ 同上 |

## 校验

```bash
npm run check        # 全部 .mjs 语法 + 版本一致性
npm test             # 笔记 MCP 协议冒烟 + 摘要冒烟
npm run test:apply   # 插件契约冒烟（需 DSH peer 依赖，见 PUBLISHING.md）
```

## 发布

把 `package.json` / `LICENSE` 里的 `OWNER` 占位符替换成你的名字，然后按
[`PUBLISHING.md`](PUBLISHING.md) 走：本地验收 → 建仓推送 → **打 `dsh-plugin` topic** → 可选 npm 发布。

> ⚠️ `dsh-plugin` topic 是社区检索插件的约定，不打就没人能发现你。

## 与现有能力的关系

| 能力 | 实现 | 本 bundle 角色 |
|---|---|---|
| 记忆 / 上下文 | `@openviking/dsh-memory-plugin` | 复用，不重复造 |
| 日程 / 待办 / 提醒 | 钉钉 `dws`（`dingtalk-*` skill） | 复用，路由过去 |
| 笔记 / 速记 | 本 bundle（本地 SQLite + MCP）| **已自建（M1）** |
| 主动智能 | 本 bundle（`agent/pre-step` 注入）| **已自建（M1）** |

## 路线图

| 阶段 | 交付 | 验收 |
|---|---|---|
| M0 ✅ | 脚手架可加载 + skill 可挂载 | `--dump-config` 可见、skill 出现在目录 |
| M1 ✅ | 笔记后端 MCP + 主动摘要注入 | 一句话记笔记→检索；开对话见今日摘要 |
| M2 | 跨能力编排（记忆+dws+笔记） | 一句话多能力串联跑通 |
| M3 | 主动智能打磨 + 安全确认完善 | 演示可用 |
