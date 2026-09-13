# 部署手册：Mac 开发 → GitHub → Windows 常驻

> 本文所有命令均已在其标注的平台上核实。
> **PowerShell 脚本部分我无法在 Mac 上实测**，因此手册的**命令序列是主交付物**，脚本只是它的封装 —— 首次部署建议先手动逐条执行并核对输出。

---

## 0. 拓扑与职责

```
   Mac（开发机）                    GitHub（私有仓库）              Windows（常驻 host）
   ─────────────                    ──────────────────              ───────────────────
   改插件代码                                                        dsh web 常驻
   npm run check / test          ←── push ──┐                        personal-assistant 运行
   git push origin main ────────────────────┘                       收发华为推送
   记下 SHA ────────────────────────────────→  pnpm 按 SHA 拉取        手机经 Tailscale 接入
```

**唯一的同步通道是 GitHub。** 不要在 Windows 上手改插件源码 —— 两端一旦漂移就很难查。

**版本锚点是 commit SHA。** 你 profile 里已有的 `dsh-harmony-next` 就是这么钉的（`github:linhay/harmony-next.skills#880420cc...`）。跟着这个惯例走：**每次部署都钉到确切 SHA**，而不是 `#main`。这样 Windows 上装的是哪个版本是可追溯、可回滚的。

---

## 1. Mac 侧：开发与发布

两种模式，都用 `deploy/mac/release.sh`：

### 1.1 日常提交（不发布）

```bash
cd ~/deepseek-harness-workspace/open-assistant/dsh-personal-assistant
deploy/mac/release.sh "feat: 加入 xxx"
```

等价于 `npm run check && npm test && git add -A && git commit && git push origin main`。
**不产生 tag，Windows 侧不会自动升级** —— 适合"先推上去存着"的中间状态。

### 1.2 发布（产生 tag，Windows 才可升级）

```bash
deploy/mac/release.sh "发布说明" --publish patch     # 或 minor / major
```

比日常提交多做三件事：

1. `npm version patch|minor|major --no-git-tag-version` 改 `package.json`
2. **同步 `config.mjs` 里的 `PLUGIN_VERSION`** —— 这两个字面量由 `npm run check` 强制一致，只改一处会让 CI 直接红
3. 复检通过后打 tag `vX.Y.Z` 并推送

> **发布与提交的唯一区别就是 tag。** Windows 侧靠 `git ls-remote --tags` 找最新版本，所以只有打了 tag 才会被升级。

### 1.3 手工步骤（脚本不可用时）

```bash
npm run check && npm test
git add -A && git commit -m "..."
npm version patch --no-git-tag-version
# 手工把 config.mjs 里的 PLUGIN_VERSION 改成同一个版本号
npm run check                       # 必须通过，否则不要打 tag
git add -A && git commit -m "release vX.Y.Z"
git tag -a vX.Y.Z -m "..."
git push origin main && git push origin vX.Y.Z
```

> `npm run test:apply` 需要 peer 依赖，本地跑法见 `.github/workflows/ci.yml` 末尾注释（CI 现在已有 windows-latest 矩阵，跨平台问题会在那里暴露）。

---

## 2. Windows 侧：首次安装

### 2.0 先切到 PowerShell

**本节及以后所有命令都是 PowerShell，不是 `cmd.exe`。** 两者语法不通用 —— `Get-Command`、`Test-Path`、`Get-Content`、`New-NetFirewallRule` 这类在 cmd 里会报「不是内部或外部命令，也不是可运行的程序」。

判断自己在哪个 shell，看提示符：

| 提示符 | shell |
|---|---|
| `d:\DSH_workspace>` | **cmd.exe** ❌ |
| `PS D:\DSH_workspace>` | PowerShell ✅ |

**最快切换方式**：在当前的 cmd 窗口里直接敲

```powershell
powershell
```

会进入 PowerShell 并**保持当前目录**。其他方式：`Win + X` → 「终端」/「Windows PowerShell」，或开始菜单搜 PowerShell。

> **注意区分**：`node` / `npm` / `pnpm` / `dsh` / `git` / `ssh` 这些是**外部程序，在 cmd 和 PowerShell 里都能跑**。所以体检里那几条在 cmd 里成功是正常的；只有 PowerShell 专有的 cmdlet（`Get-Command`、`Test-Path` 等）才会失败。**别因为部分命令能跑就以为 shell 无所谓。**

后面涉及**防火墙、电源、计划任务**的步骤（§2.6 / §2.7 / §2.10）需要**管理员 PowerShell**：开始菜单搜 `PowerShell` → 右键 → **以管理员身份运行**。

> `dsh plugin add`（§2.4）**不需要**管理员权限，用普通 PowerShell 跑即可 —— 它只写 `%USERPROFILE%\.dsh\`。

### 2.1 环境体检（只读，**先跑这个**）

六条命令**都不改变系统状态**，跑完把输出贴出来即可定位问题。别急着装东西。

```powershell
node -v
pnpm -v
dsh --version
ssh -T git@github.com
tailscale status
git ls-remote --tags --refs git@github.com:softjava2026/dsh-personal-assistant.git
```

对照表：

| 命令 | 期望 | 不满足时怎么办 |
|---|---|---|
| `node -v` | `v24.x` 或更高 | 从 https://nodejs.org 装 LTS。插件用 `node:sqlite`，Node 22.5 才有且需 flag |
| `pnpm -v` | 任意版本号 | `npm install -g pnpm`（`dsh plugin` 本质是 pnpm 的转发器） |
| `dsh --version` | 任意版本号 | `npm install -g @deepseek-ai/dsh` |
| `ssh -T git@github.com` | `Hi softjava2026/dsh-personal-assistant! You've successfully authenticated`（**Deploy key 打招呼的是仓库名**，账号级 key 才是用户名） | 见 §2.2 配 Deploy key。⚠️ **该命令成功时也返回 exit 1，这是 GitHub 的正常行为，不是失败** |
| `tailscale status` | 本机与手机都在线 | 装 https://tailscale.com/download/windows，登录同一 tailnet |
| `git ls-remote --tags` | 列出 `refs/tags/v0.1.1`、`refs/tags/v0.1.2` | 说明 SSH 凭据没生效（这条**完全走 SSH，与 npm registry 无关**，能精确区分两类网络问题） |

最后一条尤其有用：它同时验证了「GitHub 可达」和「私有仓库可读」，而这两件事正是后续 `dsh plugin add` 的前提。**六条全过，再继续 §2.3。**

> **`pnpm -v` / `dsh ...` 报「因为在此系统上禁止运行脚本」怎么办？**
>
> npm 全局安装的每个 CLI 都会生成**两个垫片**：`pnpm.cmd` + `pnpm.ps1`（`dsh` 同理）。**cmd.exe 用 `.cmd`，PowerShell 优先用 `.ps1`** —— 而 Windows 默认的 `Restricted` 执行策略不允许运行任何 `.ps1`。
>
> 这解释了一个容易困惑的现象：同一条 `dsh --version`，在 cmd 里能跑、切到 PowerShell 就报错。**不是 dsh 坏了，是两者选的垫片不同。**
>
> **两条路，建议第 2 条：**
>
> 1. **临时绕过**：显式调 `.cmd` 版本 —— `pnpm.cmd -v`、`dsh.cmd --version`
> 2. **放开策略**（推荐，而且后续防火墙 / 计划任务步骤本来就必须在 PowerShell 里做）：
>    ```powershell
>    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
>    ```
>    `-Scope CurrentUser` 只影响当前账户、**不需要管理员**；`RemoteSigned` 允许本地脚本、要求下载来的脚本带签名 —— 微软推荐的常规档位。**不要**用 `Unrestricted` 或 `Bypass`。
>
>    会提示确认，输 `Y`。验证：
>    ```powershell
>    Get-ExecutionPolicy -Scope CurrentUser    # 期望输出 RemoteSigned
>    pnpm -v
>    dsh --version
>    ```
>
> 补充：DSH **内部**调用 pnpm 用的是 `spawnSync("pnpm", args, { shell: process.platform === "win32" })`，走 cmd.exe，本来就不受策略影响。**受影响的始终是你在 PowerShell 里手敲的那一层。**

**装 Node / Git / pnpm：**

体检里任何一条报 `无法将"xxx"项识别为 cmdlet`，就是该工具没装或不在 PATH。Windows 10/11 自带 `winget`，优先用它：

```powershell
winget install OpenJS.NodeJS.LTS     # Node.js LTS —— 必须是 24.x，见下方说明
winget install Git.Git               # git ls-remote / dsh plugin 从 git 拉包都要它
```

装完**必须关掉当前 PowerShell 窗口、重新开一个** —— 安装器改的是系统 PATH，已打开的进程不会刷新。这一步漏掉会让你以为"装了却还是找不到"。

重开后验证并装剩下两个：

```powershell
node -v                # 期望 v24.x
npm -v
npm install -g pnpm
npm install -g @deepseek-ai/dsh
```

> **为什么必须是 Node 24 而不是 latest：** 插件的 `engines` 是 `^22.19.0 || >=24`，且用了内置的 `node:sqlite`（Node 22.5 才引入，22 上还需 `--experimental-sqlite` flag，24+ 免 flag）。CI 也只跑 24.x。装 Node 26 当前版虽然满足 `>=24`，但没必要冒新版本兼容风险 —— 跟 CI 对齐最稳。
>
> `winget` 不可用（旧版 Windows）时，从 https://nodejs.org 下 LTS 安装包，安装时保持"Add to PATH"勾选。

### 2.2 给 Windows 配 GitHub 访问（仓库是私有的）

**推荐用 SSH + Deploy Key（只读）**，而不是把 PAT 写进 URL —— 后者会把 token 落进 profile 的 `package.json`。

**第 1 步：确认 `ssh` 命令存在**

```powershell
Get-Command ssh
```

报 `CommandNotFoundException` 说明没装 OpenSSH 客户端，用管理员 PowerShell 装：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

**第 2 步：看有没有现成的密钥**

```powershell
Test-Path "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

- `True` → 跳过第 3 步，直接打印公钥：
  ```powershell
  Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
  ```
- `False` → 生成一把：
  ```powershell
  New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh" | Out-Null
  ssh-keygen -t ed25519 -C "dsh-host-windows" -f "$env:USERPROFILE\.ssh\id_ed25519"
  ```

  然后**只按两次回车**：

  - `Enter passphrase (empty for no passphrase):` → 回车
  - `Enter same passphrase again:` → 回车

  `-f` 已经消掉了"保存到哪个文件"的提示符，所以只剩这两个。若提示 `already exists. Overwrite (y/n)?`，输入 `n`（已有密钥就够用）。

  **然后验证密钥确实没有口令** —— 这一步能抓住下面第 2 个坑：
  ```powershell
  ssh-keygen -y -f "$env:USERPROFILE\.ssh\id_ed25519"
  ```
  能**直接打印出公钥而不询问口令**，才算对。

> ⚠️ **两个 PowerShell 专属的坑，都真实踩过：**
>
> 1. **不要用 `-N ""`。** Windows PowerShell 5.1 向外部程序传参时**会丢掉空字符串参数**，`-N ""` 变成光秃秃一个 `-N`，报 `option requires an argument -- N`。（PowerShell 7 已修此问题。）
> 2. **绝对不要用 `-N '""'`。** 这是网上流传最广的"解决办法"，但**实测它是错的**：ssh-keygen 会把口令设成**两个引号字符**，密钥被加密。你会得到一个"看起来正常、实际需要密码短语"的密钥 —— 而常驻服务没人能输入口令，**开机自启会静默失败**。上面那条 `ssh-keygen -y` 能立刻验出来（会反过来问你要口令）。

> ⚠️ **失败模式（真实踩过）**：把 `ssh-keygen -t ed25519 -C "..."` 和下一行 `Get-Content ...` 一起粘贴。`ssh-keygen` 是交互式的，会把**后续每一行都当成对提示符的回答** —— 于是它试图把密钥存到一个名为 `Get-Content "$env:USERPROFILE\..."` 的非法路径，报 `Saving key ... failed: No such file or directory`，**密钥根本没生成**。看到这个报错别往权限上想，是输入被吃掉了。
>
> ⚠️ **passphrase 必须留空。** 这是给常驻服务用的密钥，设了密码短语之后没人能交互输入，开机自启的计划任务会**静默失败** —— 而且失败得很难查。

**第 3 步：把公钥加到 GitHub**

复制上一步打印的整行（以 `ssh-ed25519` 开头），然后：**仓库 → Settings → Deploy keys → Add deploy key**，粘贴，标题随意（如 `dsh-host-windows`）。

⚠️ **`Allow write access` 不要勾。** host 只需要读。

（也可以加到账号级 SSH keys，但 Deploy key 是最小权限，更合适。）

**第 4 步：验证**

```powershell
ssh -T git@github.com
```

- 首次连接会问 `Are you sure you want to continue connecting?`，输入 `yes`
- **成功时的输出**：`Hi softjava2026/dsh-personal-assistant! You've successfully authenticated, but GitHub does not provide shell access.`
  - 用 **Deploy key** 时打招呼的是**仓库名**；用账号级 key 时才是用户名。两者都算成功。
- ⚠️ **该命令成功时也返回 exit 1**，这是 GitHub 的正常行为，不是失败

**第 5 步：回到体检**

```powershell
git ls-remote --tags --refs git@github.com:softjava2026/dsh-personal-assistant.git
```

期望看到：

```
<sha>   refs/tags/v0.1.1
<sha>   refs/tags/v0.1.2
```

看到这两行，就说明「Mac 推 → Windows 拉」这条链通了 —— 那是整个部署方案的地基。

### 2.3 安装 dsh

```powershell
npm install -g @deepseek-ai/dsh
dsh --version
```

**关于安装末尾的 `allow-scripts` 警告 —— 大概率无害，不要急着重装。**

新版 npm 默认拦截依赖的安装脚本，`npm install -g @deepseek-ai/dsh` 会警告 5 个包「install scripts not yet covered by allowScripts」。逐条核实过，对 `dsh web` + 本插件这条路径都不构成问题：

| 包 | 脚本内容 | 判断 |
|---|---|---|
| `@deepseek-ai/dsh-subprocess-local` | postinstall 是 `ensure-spawn-helper.mjs`，**整个脚本只有一句 `chmodSync(helper, 0o755)`** | Windows **没有可执行位概念，纯空操作** |
| `node-pty` | `prebuild.js \|\| node-gyp rebuild` | 包内**自带 `prebuilds/win32-x64` 与 `win32-arm64`**，无需本地编译 |
| `@google/genai` | `echo 'preinstall: no-op'` | 作者自己标的空操作 |
| `koffi` | `cnoke.cjs --prebuild` | 非 dsh 直接依赖；macOS 上同样无编译产物，但 `require` 正常 |
| `protobufjs` | `node scripts/postinstall` | 可选代码生成，非运行时必需 |

**先验证再决定**：跑 `dsh --version`，能打印版本号就继续往下走。

只有当它报原生模块加载失败（`was compiled against a different Node.js version`、`Cannot find module ... .node` 之类）时，才需要补跑允许脚本：

```powershell
npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs @deepseek-ai/dsh
```

> 此时若掉进 `node-gyp rebuild`，Windows 上还需要 Visual Studio Build Tools + Python。**尽量避开这条路** —— 先确认真的需要再装。

**关于版本**：`npm view @deepseek-ai/dsh dist-tags` 显示三个通道：

```
latest: 0.1.5-rc.1      ← npm install -g 默认拿这个
next  : 0.1.5-rc.2      ← 已发布，但走 next 通道，不会被默认装上
alpha : 0.1.5-alpha.2
```

所以**不带版本号的 `npm install -g @deepseek-ai/dsh` 在多台机器上会得到一致的版本**（已实测：macOS 与 Windows 均为 `0.1.5-rc.1`，且 `dsh-subprocess-local` / `node-pty` / `koffi` / `@google/genai` / `protobufjs` 五个子包版本逐一对齐）。

这带来的实际规则：

- **日常重装 host 时不要加 `@next` 或 `@alpha`** —— 那会把 host 推到候选通道，而插件的 peer 范围是 `>=0.1.0-rc.6 <0.2.0`，核心一旦越界（如 0.2.x），钉在 `<0.2.0` 的插件会**集体失效**。
- 需要绝对确定性时显式钉版本：`npm install -g @deepseek-ai/dsh@0.1.5-rc.1`。

### 2.4 安装插件（钉到发布 tag）

```powershell
dsh plugin --profile web add "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git#v0.1.2"
```

把 `v0.1.2` 换成目标 tag。列出可用 tag：

```powershell
git ls-remote --tags --refs git@github.com:softjava2026/dsh-personal-assistant.git
```

> **`web` profile 不存在时会自动按内置模板初始化，不需要额外步骤。** 源码里 `PROFILE_TEMPLATES` 的注释是 *"The shipped profile templates auto-initialized on first use, by name"*，其中 `web` 对应 `bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`、`patchReload: "live"`。所以首次 `dsh plugin --profile web add` 建出来的就是完整可用的 web profile。
>
> ⚠️ 但**自定义名字不会**：`PROFILE_TEMPLATES` 只认 `acp` / `web` / `headless` / `sdk` / `sdk-minimal`。其他名字会落到 `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]` —— 只有 base，**没有 web app，`dsh web` 起不来**。所以务必用 `web`。

**这一步已在 macOS 上端到端验证过**（2026-09 于 commit `fdb927a`），实测结果：

| 观察点 | 结果 |
|---|---|
| 首次运行 | 自动创建 profile：`dsh: initialized profile ...` |
| 安装耗时 | 约 70 秒（git clone + pnpm 解析） |
| 依赖记录 | `dsh-personal-assistant github:softjava2026/dsh-personal-assistant#<sha>` |
| **`dsh.profile.bundles`** | **自动追加** `dsh-personal-assistant` —— 不需要手改 `package.json` |
| 落盘内容 | `index.mjs` / `config.mjs` / `runtime.mjs` / `mcp.mjs` / `digest.mjs` / `skills.mjs` / `servers/` / `skills/` / `cordis.patch.yml` |
| `--dump-config` | 输出 `isolate: {personalAssistant: true}` 及全部配置键 ✅ |

**关于两条常见警告：**

- `dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add ... under allowBuilds` —— **这条是红鲱鱼**。只要 pnpm 命令行里出现 git spec，DSH 在**任何** pnpm 失败时都会打印它，它**不是对本次失败原因的诊断**。本插件没有 `prepare` 脚本，用不到 `allowBuilds`。看到它时请忽略，去看 pnpm 真正的报错。（`allowBuilds` 这个机制本身是真的 —— 将来若给插件加了构建步骤，需把 pnpm 打印的**确切 key** 写进 profile 的 `pnpm-workspace.yaml`，形如 `allowBuilds: { dsh-personal-assistant: true }`。）
- `[WARN] Issues with peer dependencies found` —— **预期内，无害**。profile 的 `pnpm-workspace.yaml` 里 `autoInstallPeers: false`，`@deepseek-ai/dsh-llm` 等 peer 由 DSH 自己的 `~/.dsh/profiles/node_modules` 提供（已核实三个 peer 都在）。`--dump-config` 能成功解析该层即为证明。

#### HTTPS 不通时（`ERR_PNPM_GIT_RESOLVE_FAILED`）

**症状**：`Failed to resolve git dependency ...: git ls-remote failed: fatal: unable to access 'https://github.com/...': Failed to connect to github.com:443`

**成因**：即使 spec 写的是 `git+ssh://`，pnpm 在解析阶段也可能走 **HTTPS**（因为它记录的 URL 要能在所有机器上工作）。而这台机器**SSH(22) 通、HTTPS(443) 被挡** —— 一个很常见的网络环境。

**pnpm 官方推荐的解法**是让 git 就地替换传输协议，而不改 spec：

```powershell
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

这会让**所有** `https://github.com/...` 在 git 层被改写成 `git@github.com:...`，走 SSH。

验证改写已生效：

```powershell
git config --global --get-regexp "url\..*insteadOf"
```

> **副作用要知道**：这是全局配置，影响这台机器上所有 git 操作。若以后有仓库只能用 HTTPS+token 访问（没有对应 SSH 权限），会被这条规则挡到 —— 那时用 `git config --global --unset url."git@github.com:".insteadOf` 移除即可。

**URL 形式对照（容易写错）**：

| 场景 | 正确写法 |
|---|---|
| 带 scheme（`dsh plugin add` 用这个） | `git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git#v0.1.2` ← **斜杠** |
| 不带 scheme 的 scp 风格（`git ls-remote` 用这个） | `git@github.com:softjava2026/dsh-personal-assistant.git` ← **冒号** |
| ❌ 混用（scheme 配冒号） | `git+ssh://git@github.com:softjava2026/...` —— `softjava2026` 会被当成**端口号**，git 会去连一个不存在的地址 |

**关于第一次失败留下的半成品**：`dsh: initialized profile web at ...` 说明 profile 已按内置模板建好了（`dsh-base` + `dsh-web-app`），只是插件没装上。**直接重跑即可**，不会重复初始化。

### 2.5 验证插件层已被识别

```powershell
dsh --profile web --dump-config | Select-String -Context 0,8 "personal-assistant"
```

能看到 `personal-assistant-runtime` 组和配置项即为成功。

### 2.6 防火墙 —— 最容易出事的一步

DSH 的 `host` 配置**只接受 `127.0.0.1` / `0.0.0.0`**，没有"只绑 Tailscale 网卡"的选项。所以"不暴露给局域网"**只能靠防火墙收敛**：

```powershell
New-NetFirewallRule -DisplayName "dsh web (tailnet only)" `
  -Direction Inbound -Protocol TCP -LocalPort 43120 `
  -RemoteAddress 100.64.0.0/10 -Action Allow
```

`100.64.0.0/10` 是 Tailscale 用的 CGNAT 网段 —— 只有 tailnet 内的设备能连。

**如果首次启动时 Windows Defender 弹了授权框**：只勾"专用网络"，**绝不勾"公用网络"**。

### 2.7 电源与系统更新 —— 否则 host 会随机离线

host 一离线，对话、面板、推送三条通道全断。

```powershell
powercfg /change standby-timeout-ac 0     # 睡眠 = 从不
powercfg /change hibernate-timeout-ac 0   # 休眠 = 从不
powercfg /h off                           # 关闭休眠（同时关掉"快速启动"）
```

**为什么要关"快速启动"**：它会让 Tailscale 虚拟网卡在唤醒后状态异常，表现为手机突然连不上、而本机一切正常。

还要手工处理（脚本无法可靠代劳）：

- Windows Update 改成"通知我计划重启"，或设好活动时间 —— **别让它半夜自动重启**
- 笔记本另设"合盖不睡眠"
- 关闭"按电源按钮睡眠"

### 2.8 Tailscale

```powershell
# 安装 https://tailscale.com/download/windows，登录与手机同一个 tailnet
tailscale status
tailscale serve --bg --https=443 http://127.0.0.1:43120
tailscale serve status        # 记下输出的 https://<pc>.<tailnet>.ts.net 名字
```

**为什么用 `tailscale serve` 而不是明文 HTTP**：拿到真 TLS 证书（鸿蒙侧不用碰明文策略）、cookie 能带 `Secure`、且只在 tailnet 内可达。鸿蒙 NEXT **默认允许明文 HTTP**（与 Android 相反），所以这纯粹是安全选择，不是平台限制。

### 2.9 启动 host

```powershell
$TsName = "<pc>.<tailnet>.ts.net"     # 来自上一步 tailscale serve status

dsh web --host 0.0.0.0 --port 43120 --no-open --trusted-host $TsName *> C:\dsh-host\dsh-web.log
```

`--trusted-host` 是**必需的**：`dsh-client-connection` 在认证之前先过 `api-request-trust`，要求请求的 `Host` 头是 loopback 或精确命中白名单。如果 serve 把 Host 改写成 `127.0.0.1`，这条就是冗余的 —— **两种情况都设它是安全的**。

**启动令牌**：`dsh web` 每次启动会打印一个带 `?token=` 的 URL（日志里能找到）。这个令牌每次重启都变，但用它交换到的 bearer cookie 由 `$DSH_HOME/.credentials.yaml` 的签名密钥签发，**跨重启有效**。所以：

- 手机只需在**首次配对**时粘贴一次那条 URL
- 之后计划任务重启 host，**app 不需要重新配对**
- 只有 `%USERPROFILE%\.dsh\.credentials.yaml` 被删掉时，才需要重新配对

### 2.10 注册开机自启

**必须用 `-AtLogOn` 而不是 `-AtStartup`**，这一点很容易踩：

| 方案 | 问题 |
|---|---|
| `-AtStartup` + 指定用户 | 启动触发的任务以特定用户身份运行**需要存储密码**，否则注册失败 |
| `-AtStartup` + `SYSTEM` | `%USERPROFILE%` 会指向 SYSTEM 的 profile，于是 `~/.dsh` 解析到 `systemprofile\.dsh` —— **插件、凭据、会话全都找不到** |
| **`-AtLogOn` + 当前用户** ✅ | 无需密码、路径正确。代价是需要配自动登录（或用 NSSM 注册成服务） |

```powershell
$ArgLine  = "web --host 0.0.0.0 --port 43120 --no-open --trusted-host <pc>.<tailnet>.ts.net"
$Action   = New-ScheduledTaskAction -Execute "dsh" -Argument $ArgLine
$Trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$Settings = New-ScheduledTaskSettingsSet -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "dsh-web-host" -Action $Action -Trigger $Trigger `
  -Settings $Settings -RunLevel Highest
```

`-ExecutionTimeLimit ([TimeSpan]::Zero)` = **不限时**，这一条很关键 —— 默认 3 天会被强杀。

配套还要配**自动登录**（否则机器重启后停在登录界面，任务不会启动）：

```
netplwiz  →  取消勾选「要使用本计算机，用户必须输入用户名和密码」
```

如果需要真正的"未登录也运行"，改用 [NSSM](https://nssm.cc/) 把 `dsh web` 注册成 Windows 服务 —— 但此时必须显式设置 `DSH_HOME` 环境变量指向真实用户目录，否则会撞上上面 SYSTEM 的那个坑。

需要用**管理员** PowerShell 执行。首跑后到「任务计划程序」里确认状态，并检查 `C:\dsh-host\dsh-web.log`。

**本脚本化**：`deploy\windows\setup-host.ps1` 把 §2.3–§2.10 串成一步（⚠️ 尚未在真实 Windows 上实测，首次部署建议先按本文手动走一遍）。

---

## 3. 日常更新：Mac 发布 → Windows 升级

Mac 上发布后，Windows 上**一条命令**：

```powershell
cd C:\dsh-host\dsh-personal-assistant
.\deploy\windows\update-plugin.ps1
```

它会：

1. `git ls-remote --tags` 解析最新 semver tag（**无需 clone，也无需手工搬 SHA**）
2. 比对当前已安装版本，相同就跳过（`-Force` 可强制重装）
3. `dsh plugin --profile web add "<repo>#<tag>"`
4. 校验 `--dump-config` 里确实有 `personal-assistant` —— **校验失败就不重启服务**，避免把好的版本停掉
5. 重启计划任务

常用变体：

```powershell
.\update-plugin.ps1 -Version v0.2.0   # 指定版本（回滚也用这个）
.\update-plugin.ps1 -NoRestart        # 只换版本，不重启
.\update-plugin.ps1 -Force            # 已是最新也重装
```

**手工等价命令**：

```powershell
dsh plugin --profile web add "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git#v0.2.0"

Stop-ScheduledTask  -TaskName "dsh-web-host"
Start-ScheduledTask -TaskName "dsh-web-host"
```

> 用 `dsh plugin update` 是**不行的** —— 依赖被钉在确切 tag 上，`update` 不会移动它。**回滚**同理：`-Version v0.1.0` 重新 add 即可。

### 关于自动升级

**不建议让 host 自动升级。** 升级要重启 `dsh web`，会打断正在跑的会话；新版本若出问题，代价是整个服务不可用。当前设计刻意保留"人工点一下"这一环。

如果确实想省事，建议只做**通知**不做升级：每天 `git ls-remote` 比对一次，有新版就发一条华为推送给你（复用通道③），你自己挑时间升。

---

## 4. 验证清单

| # | 检查 | 期望 |
|---|---|---|
| 1 | `dsh --profile web --dump-config \| Select-String personal-assistant` | 出现 `personal-assistant-runtime` |
| 2 | 手机上打开 `https://<pc>.<tailnet>.ts.net/` | DSH Web GUI 正常加载 |
| 3 | 手机 Tailscale 关闭后再打开该 URL | 连不上（证明确实只在 tailnet 内） |
| 4 | 局域网内另一台设备访问 `http://<pc局域网IP>:43120` | **被拒**（`trusted-host` 栅栏生效） |
| 5 | host 重启后，app 里对话仍可用 | 不用重新配对（cookie 跨重启有效） |
| 6 | Windows 重启后 | 计划任务自动拉起 `dsh web` |

第 3、4 条是**安全验证**，别跳过。

---

## 5. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_PNPM_FETCH_404 ... repo.harmonyos.com` | npm registry 被指到了失效的鸿蒙源 | 检查 `%USERPROFILE%\.npmrc`，应为 `registry=https://registry.npmjs.org/` |
| `ERR_PNPM_GIT_RESOLVE_FAILED` + `Failed to connect to github.com:443` | **pnpm 用 HTTPS 解析 git 依赖，而这台机器 HTTPS 不通**（SSH 通但 443 被挡） | 见 §2.4 的「HTTPS 不通时」小节。核心是让 git 把 GitHub 的 HTTPS 就地改写成 SSH |
| `pnpm not found on PATH` | 没装 pnpm | `npm install -g pnpm` |
| `ssh -T git@github.com` 失败 | Windows 上没有可用密钥 | 见 §2.2 |
| 手机能连 tailnet 但打不开 GUI | `--trusted-host` 名字写错 | 用 `tailscale serve status` 里的**确切**名字 |
| 手机能打开 GUI 但操作 401 | cookie 失效 | 重新粘贴 `?token=` URL 配对 |
| GUI 白屏 / 静态资源 404 | 用错了 profile | 确认是 `--profile web` |
| 插件装了但没生效 | 没进 `bundles` | `--dump-config` 检查；理论上会自动追加，见 §2.4 |
| 手机突然连不上、本机正常 | "快速启动"导致 Tailscale 网卡异常 | `powercfg /h off` 并重启 |
| `npm run check` 失败找不到 `scripts/` | 正常：`files` 字段排除了它 | 这是**开发者脚本**，只在 Mac 仓库根目录跑 |

---

## 6. 为什么是这套（设计依据）

1. **版本锚点用 SHA 而不是分支** —— 与 profile 里 `dsh-harmony-next` 的现有惯例一致；可追溯、可回滚，且避免了"Windows 上跑的是哪个版本"这种无法回答的问题。
2. **Windows 只读仓库** —— Deploy key 不给写权限。Windows 是运行环境，不是开发环境。
3. **部署脚本不进 npm 包** —— `package.json` 的 `files` 字段刻意不含 `deploy/`；它只在 git 仓库里存在，不会污染安装到 profile 的产物。
4. **不手改 profile 的 `package.json`** —— `dsh plugin` 的 `reconcilePlugins` 会根据"装上的包是否声明 `dsh.bundle`"自动维护 `dsh.profile.bundles`。手改反而会被下一次 add/remove 覆盖。
