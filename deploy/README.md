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

### 2.0.1 可选：把 DSH 数据目录放到 C 盘以外

默认 `$DSH_HOME` 是 `%USERPROFILE%\.dsh`（即 `C:\Users\<你>\.dsh`）。要放到别的盘：

```powershell
[Environment]::SetEnvironmentVariable("DSH_HOME", "D:\DSH_workspace\.dsh", "User")
```

**解析优先级**（源码 `@deepseek-ai/dsh-home-paths`）：

```
显式传入的路径  >  $DSH_HOME  >  ~/.dsh
```

空值或纯空白的 `$DSH_HOME` 视为未设置；支持 `~`、`~/`、`~\` 前缀展开。

> ⚠️ **必须在第一次 `dsh plugin add` 之前做。** profile 是在那一刻按 `$DSH_HOME\profiles\<name>` 创建的；之后再改环境变量，DSH 会去新位置找，而旧 profile 留在原地。

要点：

- **改完必须关掉 PowerShell 重开** —— 环境变量不会热更新。
- 用 `[Environment]::SetEnvironmentVariable(..., "User")` 而**不是 `setx`**：前者对含空格/特殊字符的值更可靠，也没有 1024 字符截断问题。
- 设成 **User 级**，计划任务（AtLogOn + 当前用户）能继承 ✓。但若把任务改成以 `SYSTEM` 或别的账户运行，就继承不到了 —— 与 §2.10 里那个陷阱同源。
- `$DSH_HOME` 下有 `profiles/`、`storages/`、`sessions/`、`settings.yaml`、`.credentials.yaml` —— **全部**跟着搬。
- pnpm 的内容寻址 store 默认在 `%LOCALAPPDATA%\pnpm`（仍在 C 盘）。它只是缓存，**可以不动**；非要一起搬就设 `PNPM_HOME` 并用 `pnpm config set store-dir`。

**如果已经在 C 盘初始化过了**，最干净的做法是删掉重来：

```powershell
Remove-Item -Recurse -Force "C:\Users\<你>\.dsh"
```

> **为什么建议删而不是移动**：那份 profile 是 pnpm 装出来的，`node_modules` 里可能含**硬链接**（pnpm 的默认去重手段），而**硬链接无法跨盘**，直接移动会得到一份行为不确定的副本。而 profile 是 DSH 会自动重建的（见 §2.4），删掉没有损失。此时它通常也还没装成功任何东西。

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

**成因（已实测确认）**：**即使 spec 写成正确的 `git+ssh://git@github.com/owner/repo`，pnpm 仍会用 HTTPS 解析。** 报错里能看到 pnpm 把 spec 规范化成 `github:owner/repo`，随后调用 `git ls-remote https://github.com/owner/repo.git`。

> 也就是说 **`git+ssh://` 前缀并不能让 pnpm 走 SSH** —— 它记录的 URL 要"能在所有机器上工作"，于是选了 HTTPS。这也解释了为什么同一条命令在 macOS 上能过：那台机器 HTTPS 通。
>
> 所以看到 `Failed to connect to github.com:443` 时，**不要怀疑自己的 URL 写错了** —— 那是 pnpm 主动选 HTTPS 的结果。

**解法**（pnpm 官方推荐）：让 git 在传输层就地改写，而不改 spec：

```powershell
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

这会让**所有** `https://github.com/...` 在 git 层被改写成 `git@github.com:...`，走 SSH。

**实测有效**（Windows + pnpm 12.4.1）：加上该配置后，同一条 `dsh plugin add` 从 `ERR_PNPM_GIT_RESOLVE_FAILED` 变为成功，15 秒完成。

> **注意 pnpm 大版本差异。** 出问题的机器是 **pnpm 12.4.1**，而 macOS 上用的是 **pnpm 11.8.0** —— 同一条命令、同一个 `git+ssh://` spec，在 11.8.0 上**不需要** `insteadOf` 就能成功。
>
> 怀疑是 pnpm 12 改变了 git 依赖的解析方式（强制走 HTTPS 以生成"到处都能装"的 lockfile URL）。**这只是观察，没有做对照实验证实**，但实践含义明确：**dev 机与 host 的 pnpm 大版本不一致时，装插件的行为可能不同**。遇到 git 解析类失败优先怀疑这里。
>
> 排查版本：`pnpm -v`。要对齐可用 `npm install -g pnpm@11`。

**验证改写确实生效** —— 下面这条 URL 走 HTTPS、本该失败，改写后应该成功：

```powershell
git ls-remote --tags --refs https://github.com/softjava2026/dsh-personal-assistant.git
```

能看到 `refs/tags/v0.1.1` 与 `refs/tags/v0.1.2` 才算生效。（`git config --global --get-regexp "url\..*insteadOf"` 只能证明配置**写进去了**，不能证明它**被应用**。）

**若 insteadOf 也不行**（例如 SSH 同样被挡），还有一条完全绕开 git 的路：在 Mac 上 `npm pack` 打出 `.tgz`，传到 Windows 后

```powershell
dsh plugin --profile web add .\dsh-personal-assistant-0.1.2.tgz
```

pnpm 支持本地 tarball，全程不碰网络。代价是失去"GitHub 是唯一通道"的简洁性，只作为最后手段。

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

### 2.6 防火墙 —— **不需要手动配置**

因为走 `tailscale serve`（见 §2.8），**`dsh web` 只监听 `127.0.0.1`，不碰 `0.0.0.0`** —— 局域网里的设备从网络层就连不上它。暴露给 tailnet 的只有 Tailscale 自己监听的 443，而它的安装程序已经配好了自己的防火墙规则。

**所以不需要 `New-NetFirewallRule`，也不会弹 Defender 授权框。**

> ⚠️ **不要用 `--host 0.0.0.0`。** 那会让 dsh 监听所有网卡、把服务暴露给整个局域网，然后再想用防火墙拦回来 —— 等于自己制造风险再去弥补。Tailscale 官方文档也明确建议后端服务**只监听 localhost**：
>
> > it's best practice to only have the service listen on localhost. Otherwise, any user that can call your service directly (rather than with the Serve URL) could trivially provide their own values for these HTTP headers.
>
> **唯一需要 `0.0.0.0` + 防火墙规则的情况**：不打算用 `tailscale serve`，直接让手机连 `http://<内网IP>:43120`。那条路是明文 HTTP、无 TLS，且 dsh 自己的 cookie 不带 `Secure`，只在完全可信的内网里勉强可接受：
>
> ```powershell
> New-NetFirewallRule -DisplayName "dsh web (tailnet only)" `
>   -Direction Inbound -Protocol TCP -LocalPort 43120 `
>   -RemoteAddress 100.64.0.0/10 -Action Allow
> ```
>
> `100.64.0.0/10` 是 Tailscale 的 CGNAT 网段。走了这条路才需要勾"专用网络"的 Defender 授权框（**绝不勾"公用网络"**）。

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

### 2.8 远程访问 —— **不要走 VPN 这条路**

#### 快速决策

| 你的场景 | 怎么做 | 成本 | 流量经过 |
|---|---|---|---|
| 只在家（同一 Wi-Fi） | `dsh-remote-web-ui` → 开**内网访问** → 扫码 | 0 | 只在你家路由器内 |
| **出门也要用（移动数据）** | 同一个插件 → 开**自动公网隧道**（固定域名中继默认开启） | **0** | Cloudflare + **插件作者的 Worker** |
| 出门要用，且想避开第三方中继 | 同一个插件 → 改用**自带域名的命名隧道** | 一个域名（约 ¥50/年） | 只有 Cloudflare |
| 出门要用，且流量要完全自主 | `dsh-webgate` + VPS + frp + Caddy + 登录门户 | VPS + 域名 | 只有你自己 |
| 出门要用，且完全不想碰第三方 | 自建 WireGuard + 家用路由器端口转发 + [harmonyos-wg-client](https://github.com/wan0791/harmonyos-wg-client) | 0 | 直连，但客户端是 v0.1.1 社区项目，且**家宽若在 CGNAT 后则端口转发无效** |

> **"固定域名中继"解决的是什么问题**：Cloudflare 快速隧道的域名每次 `cloudflared` 启动都随机变，手机上的书签和二维码就失效了。中继把 `https://<id>.dsh-market.com` 这个**永不变**的地址前置在临时地址上，于是"配对一次、跨重启有效"。代价是流量多经一层作者运营的 Cloudflare Worker。
>
> 不想付这个代价又不想买 VPS，就买一个域名走命名隧道 —— 主机名同样永久固定，且只经 Cloudflare。

**先给结论：想让鸿蒙手机用上 DSH，任何"组网型 VPN"都不要装。** 原因是结构性的：

**这一类工具全都要求手机装客户端，而鸿蒙 NEXT 恰恰是它们的空白区。**

| 工具 | 桌面端 | 鸿蒙 NEXT 客户端 |
|---|---|---|
| Tailscale | ✅ | ❌ 官方无（[#18207](https://github.com/tailscale/tailscale/issues/18207) 仍是 feature request）；社区 [Tailscale-OHOS](https://github.com/flypigJ/Tailscale-OHOS) 自称 *"engineering MVP, **not release-ready**"* 且 **MagicDNS 禁用** —— 与 `tailscale serve` 的 DNS 证书冲突 |
| ZeroTier | ✅ | ❌ [官方兼容表](https://docs.zerotier.com/compatibility/) 里**完全没有鸿蒙**（Tier 1/2/3 都没有） |
| NetBird | ✅ | ❌ 无 |
| Headscale（自建控制面） | ✅ | ❌ 客户端仍然得用 Tailscale 的 |
| 自建 WireGuard + [harmonyos-wg-client](https://github.com/wan0791/harmonyos-wg-client) | ✅ | ⚠️ 社区 v0.1.1：握手与加解密通过，但**「互联网路由」被 `VpnConfig.routes` API 阻塞** |

> 那个 WireGuard 客户端有个微妙之处：它**不能路由公网流量**，但 **VPN 子网内可达** —— 而我们的需求恰恰只是"手机能到 Windows 那台机器"，所以**理论上够用**。代价是：自己编译 HAP、在家用路由器上做端口转发（WireGuard 需要可达入口）、并用一个 v0.1.1 的社区客户端承载全部访问。**不推荐，但可以备选。**

**你真正需要的是「手机能打开一个网址」，不是 VPN。** 隧道类工具**手机侧零客户端**，浏览器即可 —— 鸿蒙不鸿蒙都无所谓。

#### 两个 DSH 远程访问插件，各有取舍

| | `@linxin666/dsh-remote-web-ui` | `dsh-webgate` |
|---|---|---|
| 内网访问 | ✅ 局域网绑定开关（自动维护防火墙） | ✅ 默认开启 + 二维码 |
| 快速隧道 | ✅ `cloudflared` 随包分发 | ✅ 托管 cloudflared 进程 |
| **固定主机名** | ✅ 中继 `https://<id>.dsh-market.com`（**经作者 Cloudflare Worker**）或自带域名命名隧道 | — |
| **完全自建** | — | ✅ **frp + 自有 VPS + Caddy** |
| **鉴权** | 扫码配对 + 设备会话（可逐个吊销） | **登录门户**（scrypt 密码 + 30 天 Cookie + 每 IP 限速） |
| 手机体验 | ✅ **竖屏触控适配层**（手势/触控目标/隐藏桌面工具面） | 仅兼容性修复（UUID polyfill 等） |
| 要求 | 无 | frp 模式需**一台公网 VPS + 域名** |

选法：

- **不想花钱、要手机体验好** → `dsh-remote-web-ui`，但接受"固定域名中继经第三方"
- **要流量完全自主** → `dsh-webgate` + VPS + frp + Caddy + 登录门户
- **只在家用** → 任选其一，只开内网

> ⚠️ **不要同时装两个。** 它们都在改 webserver 绑定、connection 信任列表和客户端注入，功能面重叠 —— 大概率互相打架。选一个。

### 2.8.1 推荐路径：`@linxin666/dsh-remote-web-ui`

它把本手册前面所有手工步骤都产品化了：

| 本手册手工做的 | 插件已有 |
|---|---|
| 手配 `--host` / `--trusted-host` | 设置卡片里一个**局域网绑定开关**（写 profile 的 `cordis.patch.yml`） |
| 手工建防火墙规则 | 插件**自己维护**（Windows 经 `netsh`） |
| 粘贴 `?token=` URL 配对 | **扫码配对**，一次性令牌 + 可吊销设备会话 |
| 手机上看桌面版界面 | **竖屏触控适配层**（手势、触控目标、Enter 只换行、隐藏桌面工具面） |
| 手工 `tailscale serve` | **一键 Cloudflare 快速隧道**（`cloudflared` 随包分发） |
| — | **固定域名中继** `https://<id>.dsh-market.com`，**主机名永不变**，配对一次跨重启有效 |

**手机侧不需要装任何 VPN 客户端** —— 浏览器即可（我们自己的 app 里就是 WebView）。**鸿蒙没有 Tailscale 客户端这个问题因此不存在。**

安装（npm 公开包，**不走 GitHub SSH**，`engines` 都满足：Node `>=24`、dsh `>=0.1.5-rc.1`）：

```powershell
dsh plugin --profile web add @linxin666/dsh-remote-web-ui
```

然后在 `dsh web` 里点侧栏底部的手机图标，扫码。

#### 三条隧道，信任模型不同

| 方案 | 主机名 | 流量经过 | 适合 |
|---|---|---|---|
| 一键快速隧道 **+ 固定域名中继** | `https://<id>.dsh-market.com`（永久） | **包作者运营的 Cloudflare Worker** | 最省事，无需域名/账号 |
| **命名隧道**（自带域名） | 你自己的域名（永久） | 只有 Cloudflare | 有域名，想避开第三方中继 |
| **只用局域网绑定** | `<内网IP>:43120` | 你的内网 | 只在家用、网络完全可信 |

> ⚠️ **中继的信任代价（README 自己写明）**：开启中继时，手机访问的是 dsh-market 的 Cloudflare Worker，它**逐字节转发**请求，因此**作者的基础设施可以看到这些流量** —— 与 Cloudflare 对裸 `trycloudflare.com` 的可见性相同。配对 Cookie 与应用层校验仍留在你的实例上，worker 不终结配对。介意就走命名隧道，或只在内网用。

#### 两条必须知道的安全边界

README 的安全模型里有两条不能忽略：

> **配对不门控直连 `/api`。** ... 来自局域网源头的直连 `/api` 仅由 harness 围栏（`0.0.0.0` 绑定下自动信任局域网字面量）加 harness 浏览器认证 cookie 约束。

所以**"局域网绑定"是要认真做的决定，不是随手一开**。插件自己的建议是：*"请把局域网绑定当作深思熟虑的决定，在共享机器上优先回环加隧道。"*

- **配对设备是完全控制凭据** —— 可达完整 host API（聊天、会话、设置、**凭据**、产出物）。只配对你自己的设备。
- **撤销约束的是 `/remote` 通道与配对 cookie，不是 harness 浏览器凭据** —— 设备兑换过的浏览器凭据在取消配对后仍有效，直到自然过期（默认 30 天）。

### 2.8b 备选：Tailscale 与 HTTPS 证书

**只有当你确实需要"自建、不经第三方"的内网互通时才走这条路**，且要接受手机侧需自行编译客户端（见 §2.8 开头）。

**第 1 步：装好并登录**

```powershell
# 安装 https://tailscale.com/download/windows，登录与手机同一个 tailnet
tailscale status
```

**第 2 步：在管理后台开启 HTTPS 证书** —— 这是 `tailscale serve` 的**前置条件**：

1. 打开 admin console 的 [DNS 页面](https://console.tailscale.com/admin/dns)
2. 确认 **MagicDNS** 已启用
3. 在 **HTTPS Certificates** 下点 **Enable HTTPS**
4. 确认同意「机器名与 tailnet DNS 名会发布到公开账本」

> 若跳过这步直接跑 `tailscale serve`，它会输出一个链接引导你在浏览器里授权。**第一次别加 `--bg`**，让它走完交互流程把 HTTPS 开起来。

**第 3 步：起反向代理**

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:43120
tailscale serve status        # 记下 https://<machine>.<tailnet>.ts.net
```

> ⚠️ **隐私提示（官方文档明确警告）**：开启 HTTPS 后，**机器名会被写进公开的 Certificate Transparency 账本，任何人都能查**。
>
> > Do not enable the HTTPS feature if any of your machine names contain sensitive information.
>
> 所以**先去 admin console 把机器名改成不含敏感信息的形式**（比如 `dsh-host`），再开 HTTPS。默认机器名往往是 `DESKTOP-XXXXXXX` 这类，一般不敏感，但你自己确认一下。

**为什么用 `serve` 而不是明文 HTTP**：拿到真 TLS 证书（鸿蒙侧不用碰明文策略）、cookie 能带 `Secure`、只在 tailnet 内可达，而且**后端可以只监听 loopback**（见 §2.6）。鸿蒙 NEXT **默认允许明文 HTTP**（与 Android 相反），所以这纯粹是安全选择，不是平台限制。

**附带能力**：`serve` 会在转发给后端的请求上添加 `Tailscale-User-Login` / `Tailscale-User-Name` 等身份头（仅 tailnet 流量，Funnel 没有）。将来若要做"不只是网络可达、还要身份校验"这一层，可以直接用。注意它会剥掉客户端伪造的同名头，所以后端可以信任它们。

### 2.9 启动 host

```powershell
$TsName = "<machine>.<tailnet>.ts.net"     # 来自 tailscale serve status

dsh web --host 127.0.0.1 --port 43120 --no-open --trusted-host $TsName *> D:\DSH_workspace\dsh-web.log
```

**`--host 127.0.0.1` 就够了** —— 外部流量由 `tailscale serve` 从 loopback 转发进来（理由见 §2.6）。

`--trusted-host` 是**必需的**：`dsh-client-connection` 在认证之前先过 `api-request-trust`，要求请求的 `Host` 头是 loopback 或精确命中白名单。serve 转发时会保留原来的 Host（`<machine>.<tailnet>.ts.net`），所以必须登记它。

**启动令牌**：`dsh web` 每次启动会打印一个带 `?token=` 的 URL（日志里能找到）。这个令牌每次重启都变，但用它交换到的 bearer cookie 由 `$DSH_HOME\.credentials.yaml` 的签名密钥签发，**跨重启有效**。所以：

- 手机只需在**首次配对**时粘贴一次那条 URL
- 之后计划任务重启 host，**app 不需要重新配对**
- 只有 `$DSH_HOME\.credentials.yaml` 被删掉时，才需要重新配对

### 2.10 注册开机自启

**必须用 `-AtLogOn` 而不是 `-AtStartup`**，这一点很容易踩：

| 方案 | 问题 |
|---|---|
| `-AtStartup` + 指定用户 | 启动触发的任务以特定用户身份运行**需要存储密码**，否则注册失败 |
| `-AtStartup` + `SYSTEM` | `%USERPROFILE%` 会指向 SYSTEM 的 profile，于是 `~/.dsh` 解析到 `systemprofile\.dsh` —— **插件、凭据、会话全都找不到** |
| **`-AtLogOn` + 当前用户** ✅ | 无需密码、路径正确。代价是需要配自动登录（或用 NSSM 注册成服务） |

```powershell
$ArgLine  = "web --host 127.0.0.1 --port 43120 --no-open --trusted-host <machine>.<tailnet>.ts.net"
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

需要用**管理员** PowerShell 执行。首跑后到「任务计划程序」里确认状态，并检查 `D:\DSH_workspace\dsh-web.log`。

**本脚本化**：`deploy\windows\setup-host.ps1` 把 §2.3–§2.10 串成一步（⚠️ 尚未在真实 Windows 上实测，首次部署建议先按本文手动走一遍）。

---

## 3. 日常更新：Mac 发布 → Windows 升级

Mac 上发布后，Windows 上**一条命令**：

```powershell
cd D:\DSH_workspace\dsh-personal-assistant
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
| 2 | 手机上打开 `https://<machine>.<tailnet>.ts.net/` | DSH Web GUI 正常加载 |
| 3 | 手机 Tailscale 关闭后再打开该 URL | 连不上（证明确实只在 tailnet 内） |
| 4 | 局域网内另一台设备访问 `http://<host局域网IP>:43120` | **连接被拒绝**（dsh 只监听 loopback，端口根本没对外开） |
| 5 | 在 host 本机跑 `netstat -ano \| findstr 43120` | 只应看到 `127.0.0.1:43120`，**不应出现 `0.0.0.0:43120`** |
| 6 | host 重启后，app 里对话仍可用 | 不用重新配对（cookie 跨重启有效） |
| 7 | Windows 重启后 | 计划任务自动拉起 `dsh web` |

第 3、4、5 条是**安全验证**，别跳过。第 5 条是最直接的证据 —— 它一眼就能看出有没有把服务暴露到 loopback 之外。

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
