# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划（M2）
- 跨能力编排：一句话串联 记忆 + dws + 笔记
- 安全确认打磨（高风险动作逐次确认）

## [0.1.0] - 2026-09-13

### 新增 — M1
- **笔记后端 MCP**：`servers/notes-mcp.mjs`（`node:sqlite`，零依赖，纯本地）
  - 工具：`note_create` / `note_search` / `note_list` / `note_delete`
- **主动摘要注入**：`digest.mjs` 多源采集（今日日程 / 逾期待办 / 最近笔记）
  - 每会话每天只注入一次（内存缓存 + 历史去重双保险）
  - 构造带 `source: { kind: 'plugin', form: 'proactive-digest' }` 的**可回放**消息
  - 任一来源失败 → 静默降级，绝不拖垮对话
- 新增配置项：来源开关（calendar / todo / notes）、dws 命令、注入预算
- 测试：`test/notes-mcp.input.jsonl`、`test/digest.smoke.mjs`、`test/apply.smoke.mjs`

### 变更 — M0 → M1
- `mcp.mjs`：由占位改为真实的 stdio MCP 客户端配置
- `runtime.mjs`：`proactiveContext()` 由占位改为真实实现
- `index.mjs`：启用 MCP 挂载（置于最后且不 await，避免阻塞注册）

### 新增 — M0
- 可被 `dsh plugin add` 加载的 bundle 结构
- 注册 `personalAssistant` 服务 + `agent/session-start`、`agent/pre-step` 钩子
- 隔离挂载 `personal-assistant` skill（SKILL.md + references）
