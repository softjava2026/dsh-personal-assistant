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

### 2.1 前置检查

```powershell
node -v      # 必须 >= 24。插件用 node:sqlite（Node 22.5 才有且需 flag）
pnpm -v      # 必须存在。dsh plugin 本质是 pnpm 的转发器
```

任何一个缺失就先装：

```powershell
# Node.js LTS（>= 24）从 https://nodejs.org 安装
npm install -g pnpm
```

### 2.2 给 Windows 配 GitHub 访问（仓库是私有的）

**推荐用 SSH + Deploy Key（只读）**，而不是把 PAT 写进 URL —— 后者会把 token 落进 profile 的 `package.json`。

```powershell
# 生成密钥（一路回车即可）
ssh-keygen -t ed25519 -C "dsh-host-windows"

# 打印公钥
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

把输出的公钥加到 GitHub：**仓库 → Settings → Deploy keys → Add deploy key**，勾选 *Allow write access* 时**不要勾**（host 只需要读）。或者加到你的账号 SSH keys 里。

验证：

```powershell
ssh -T git@github.com
# 期望："Hi softjava2026! You've successfully authenticated..."
```

### 2.3 安装 dsh

```powershell
npm install -g @deepseek-ai/dsh
dsh --version
```

### 2.4 安装插件（钉到 Mac 刚推的 SHA）

```powershell
$Sha = "<第 1 步 git rev-parse HEAD 的输出>"
dsh plugin --profile web add "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git#$Sha"
```

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

- `[WARN] Issues with peer dependencies found` —— **预期内，无害**。profile 的 `pnpm-workspace.yaml` 里 `autoInstallPeers: false`，`@deepseek-ai/dsh-llm` 等 peer 由 DSH 自己的 `~/.dsh/profiles/node_modules` 提供（已核实三个 peer 都在）。`--dump-config` 能成功解析该层即为证明。
- `git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed` —— **本插件不会触发**，因为 `package.json` 里**没有 `prepare` 脚本**。将来若加了构建步骤，需把 pnpm 打印的 key 写进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`：

  ```yaml
  allowBuilds:
    dsh-personal-assistant: true
  ```

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
