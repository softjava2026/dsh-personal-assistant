# 能力路由表

本文件是"个人智慧助手"的意图 → 底层能力路由，供编排时快速查表。

## 记忆 / 上下文

- **能力**：自动记忆、语义检索、画像、偏好
- **归属**：`openviking-memory`（bundle：`@openviking/dsh-memory-plugin`）
- **触发**：记住某事、回顾、"我之前说过/决定过"、分享文件/URL 值得留存
- **注意**：记忆写入与检索走 OpenViking 的 `mcp__openviking__*` 工具；不要用 filesystem/shell 直接碰 `viking://` URI。

## 日程 / 会议

- **归属**：`dingtalk-calendar`（`dws calendar`）
- **触发**：查日程、建日程、约会议、订会议室、改期、取消、闲忙查询
- **编排点**：建日程常伴随建提醒；跨天行程常伴随待办。

## 待办 / 提醒

- **归属**：`dingtalk-todo`（`dws todo`）
- **触发**：创建待办、指派、标记完成、查待办、逾期、循环待办
- **提醒**：时间提醒走日历或待办；事件/位置提醒（M1）走本 skill 的 pa 工具面。

## 笔记 / 速记

- **归属**：本 skill 的 `pa` 工具（M1 就绪）
- **触发**：记笔记、速记、语音转文字、查笔记、按标签归档
- **契约**：入参 Schema 见工作区 `contracts/skills/note.create.json`（`content` 必填，`title`/`tags`/`source` 可选）。

## 信息检索 / 摘要

- **归属**：联网搜索（内置）+ 本 skill 编排
- **触发**：查资料、天气、新闻、文档摘要、知识库检索
- **个性化**：检索结果可结合 openviking 记忆做个性化排序/补全。

## 编排示例

用户："记一下明天下午三点和产品部开会，顺便提醒我提前十分钟准备。"

拆解：
1. `dingtalk-calendar`：建日程（明天 15:00，主题"和产品部开会"）
2. `dingtalk-calendar` / `dingtalk-todo`：建提醒（14:50）
3. （可选）`openviking-memory`：记忆"与产品部有例会"

执行顺序：先建日程 → 拿到事件 ID → 建提醒并关联。
