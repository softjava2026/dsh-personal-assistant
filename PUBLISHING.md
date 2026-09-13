# 发布清单

## 0. 先替换占位符

| 文件 | 占位符 | 替换为 |
|---|---|---|
| `package.json` | `OWNER` | 你的 GitHub 用户名（repository / homepage / bugs / author 共 4 处）|
| `LICENSE` | `OWNER` | 你的名字或组织名 |
| `README.md` | — | 补上仓库地址 |

```bash
# 一键替换（macOS sed 需要 -i ''）
sed -i '' 's/OWNER/<你的用户名>/g' package.json LICENSE
```

## 1. 本地验收

```bash
npm run check      # 语法 + 版本一致性
npm test           # 笔记 MCP 协议 + 摘要冒烟

# 可选：apply 契约测试需要 DSH 宿主提供的 peer 依赖
ln -sfn "$(npm root -g)/@deepseek-ai/dsh/node_modules" ./node_modules
npm run test:apply
unlink ./node_modules
```

## 2. 建仓并推送

```bash
git init
git add -A
git commit -m "feat: dsh-personal-assistant 0.1.0 (M0 + M1)"
git branch -M main
git remote add origin git@github.com:<你的用户名>/dsh-personal-assistant.git
git push -u origin main
```

## 3. 打 `dsh-plugin` topic ⭐（关键）

GitHub 仓库页 → About 齿轮 → **Topics**，加入：

```
dsh-plugin
deepseek-harness
dsh
mcp
agent
```

`dsh-plugin` 是社区检索插件的约定 topic —— 加了之后
`find_dsh_plugin`、[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)、
[Awesome-DeepSeek-Harness-Plugins](https://github.com/Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins)
才能发现你的插件。

## 4. 发布到 npm（可选）

```bash
npm login
npm publish        # prepublishOnly 会自动跑 check + test
```

发布后社区即可一行安装：

```bash
dsh plugin --profile desktop add dsh-personal-assistant
```

## 5. 版本升级流程

1. 改 `package.json` 的 `version`
2. **同步改 `config.mjs` 的 `PLUGIN_VERSION`**（`npm run check` 会卡这个一致性）
3. 更新 `CHANGELOG.md`
4. `git tag v<version> && git push --tags`

## 6. 升级 DSH 时

DSH Desktop 升级会带来内核版本变化，`peerDependencies` 的 `>=0.1.0-rc.6 <0.2.0`
可能需要放宽。本仓库上游 `../tools/dsh-preflight.py` / `dsh-sync-check.py`
就是做这件事的，可复用。
