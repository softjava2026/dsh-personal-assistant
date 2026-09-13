<#
.SYNOPSIS
  Windows 常驻 host 的一次性安装。对应 deploy/README.md 第 2 节。

.DESCRIPTION
  做三件事：
    1. 前置检查（Node / pnpm / dsh / GitHub SSH / Tailscale）—— 先发现问题，别装到一半才炸
    2. 安装插件（钉到指定 SHA）
    3. 落地运行环境（防火墙 / 电源 / 开机自启计划任务）

  设计取向：**每一步都先打印再执行**，且都可以用 -Skip* 开关单独关掉。
  一次性操作不值得为"全自动"牺牲可核对性。

.NOTES
  ⚠️ 本脚本尚未在真实 Windows 上实测（编写环境是 macOS，且本机无 pwsh 可做语法校验）。
     首次部署强烈建议先手动逐条执行 deploy/README.md 第 2 节的命令并核对输出，
     确认无误后再用本脚本。

  需要**管理员** PowerShell（防火墙 / 电源 / 计划任务都需要）。

.EXAMPLE
  .\setup-host.ps1 -Sha fdb927abd162c93234cca713a5ef3ffd965a678f -TailscaleName "mypc.tail1234.ts.net"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Sha,

  # tailscale serve status 显示的名字，如 mypc.tail1234.ts.net
  [Parameter(Mandatory = $true)]
  [string]$TailscaleName,

  [int]$Port        = 43120,
  [string]$Profile  = "web",
  [string]$Repo     = "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git",
  [string]$TaskName = "dsh-web-host",
  [string]$LogPath  = "D:\DSH_workspace\dsh-web.log",

  [switch]$SkipFirewall,
  [switch]$SkipPower,
  [switch]$SkipTask,

  # 只有"不用 tailscale serve、直连 HTTP"时才需要入站规则。默认不需要。
  [switch]$FirewallForDirectHttp
)

$ErrorActionPreference = "Stop"

function Step($n, $text) { Write-Host "`n▶ $n $text" -ForegroundColor Cyan }
function Ok($text)       { Write-Host "  ✅ $text" -ForegroundColor Green }
function Warn($text)     { Write-Host "  ⚠️  $text" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 0. 管理员检查
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not ($SkipFirewall -and $SkipPower -and $SkipTask)) {
  throw "需要管理员权限（防火墙 / 电源 / 计划任务）。请用管理员 PowerShell 重开，或加 -SkipFirewall -SkipPower -SkipTask 只装插件。"
}

# ---------------------------------------------------------------- 1. 前置检查
Step "1/4" "前置检查"

# Node >= 24：插件用 node:sqlite（Node 22.5 才有且需 flag）
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 node。请安装 Node.js LTS（>= 24）：https://nodejs.org"
}
$nodeVer   = (& node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVer -split '\.')[0]
if ($nodeMajor -lt 24) { throw "Node 版本过低：v$nodeVer。插件需要 >= 24（node:sqlite）。" }
Ok "Node v$nodeVer"

# pnpm：dsh plugin 本质是 pnpm 的转发器
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "未找到 pnpm。执行：npm install -g pnpm"
}
Ok "pnpm $(pnpm -v)"

# dsh
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Warn "未找到 dsh，正在安装：npm install -g @deepseek-ai/dsh"
  npm install -g @deepseek-ai/dsh
  if ($LASTEXITCODE -ne 0) { throw "安装 dsh 失败" }
}
$dshVersion = (& dsh --version 2>&1 | Select-Object -First 1)
Ok "dsh $dshVersion"

# GitHub SSH（仓库是私有的）
# 注意：ssh -T 即使成功也返回 exit 1，且原生命令的 stderr 配合
# $ErrorActionPreference='Stop' 会抛 NativeCommandError。这里临时放宽。
Write-Host "  检查 GitHub SSH 访问..." -NoNewline
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$sshOut = (& ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | Out-String)
$ErrorActionPreference = $prevEap
if ($sshOut -match "successfully authenticated") {
    Ok "GitHub SSH 可用"
} else {
    throw "GitHub SSH 不可用。先按 README §2.2 配置 Deploy key。原始输出：`n$sshOut"
}

# Tailscale
$tsExe = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $tsExe) {
  $candidate = "C:\Program Files\Tailscale\tailscale.exe"
  if (Test-Path $candidate) { $tsExe = $candidate }
}
if (-not $tsExe) { throw "未找到 tailscale。请安装：https://tailscale.com/download/windows" }
Ok "tailscale：$tsExe"

# ---------------------------------------------------------------- 2. 安装插件
Step "2/4" "安装插件 @ $Sha"
& dsh plugin --profile $Profile add "$Repo#$Sha"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败（exit $LASTEXITCODE）" }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$dump = (& dsh --profile $Profile --dump-config 2>&1 | Out-String)
$ErrorActionPreference = $prevEap
if ($dump -notmatch "personal-assistant") { throw "dump-config 里没有 personal-assistant —— 安装未生效" }
Ok "插件层已注册（bundles 自动追加，无需手改 profile）"

# ---------------------------------------------------------------- 3. 运行环境
Step "3/4" "运行环境"

if (-not $SkipFirewall) {
  # 走 tailscale serve 时，dsh 只监听 127.0.0.1，局域网设备从网络层就连不上，
  # 所以【不需要】任何入站规则。暴露给 tailnet 的只有 Tailscale 自己监听的 443，
  # 它的安装程序已配好自己的防火墙规则。
  #
  # 仅当你【不用】tailscale serve、直接让手机连 http://<内网IP>:43120 时才需要下面这条，
  # 且必须显式加 -FirewallForDirectHttp 才会执行 —— 那条路是明文 HTTP，慎用。
  if ($FirewallForDirectHttp) {
    $existing = Get-NetFirewallRule -DisplayName "dsh web (tailnet only)" -ErrorAction SilentlyContinue
    if ($existing) {
      Warn "防火墙规则已存在，跳过创建"
    } else {
      New-NetFirewallRule -DisplayName "dsh web (tailnet only)" `
        -Direction Inbound -Protocol TCP -LocalPort $Port `
        -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null
      Ok "防火墙：仅允许 100.64.0.0/10（tailnet）访问 $Port（直连 HTTP 模式）"
    }
  } else {
    Ok "防火墙：无需配置（tailscale serve 模式下 dsh 只监听 loopback）"
  }
}

if (-not $SkipPower) {
  # powercfg 在部分机器/虚拟机上会返回非 0，不该因此中断安装
  & powercfg /change standby-timeout-ac 0   | Out-Null
  & powercfg /change hibernate-timeout-ac 0 | Out-Null
  # 关闭休眠会同时关掉"快速启动"—— 后者会让 Tailscale 虚拟网卡唤醒后状态异常
  & powercfg /h off                         | Out-Null
  Ok "电源：睡眠/休眠已关闭，快速启动已关闭"

  Warn "还需手工处理：Windows Update 改成「通知我计划重启」或设活动时间；笔记本设「合盖不睡眠」"
}

if (-not $SkipTask) {
  # 用 AtLogOn 而不是 AtStartup，原因：
  #   - AtStartup + 指定用户 需要存储密码，否则注册失败
  #   - AtStartup + SYSTEM 会让 %USERPROFILE% 指向 SYSTEM 的 profile，
  #     于是 ~/.dsh 解析到 systemprofile\.dsh，插件和凭据全都找不到
  #   - AtLogOn + 当前用户 无需密码且路径正确
  # 代价：需要机器自动登录。若要真正的"未登录也运行"，改用 NSSM 注册成服务。
  $argLine  = "web --host 127.0.0.1 --port $Port --no-open --trusted-host $TailscaleName"
  $action   = New-ScheduledTaskAction -Execute "dsh" -Argument $argLine
  $trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
  # ExecutionTimeLimit = 0 即不限时 —— 默认 3 天会被强杀，这一条很关键
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Warn "已存在同名任务，先删除再重建"
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest | Out-Null
  Ok "计划任务 $TaskName 已注册（登录自启 + 失败重启 3 次 + 不限时）"
}

# ---------------------------------------------------------------- 4. 下一步
Step "4/4" "还需手工完成"

$nextSteps = @"
  1. 配置自动登录（否则 AtLogOn 任务需要你手工登录后才启动）：
       netplwiz  →  取消勾选"要使用本计算机，用户必须输入用户名和密码"
     或者改用 NSSM 把 dsh web 注册成真正的服务（未登录也运行）。

  2. 先在 Tailscale 管理后台开启 HTTPS 证书（serve 的前置条件）：
       https://console.tailscale.com/admin/dns
       → 确认 MagicDNS 已启用 → HTTPS Certificates 下点 Enable HTTPS
     注意：开启后【机器名会进入公开的 Certificate Transparency 账本】，
     所以先把机器名改成不含敏感信息的形式。

  3. tailscale serve（拿到真 TLS 证书，手机侧就不用碰明文策略）：
       tailscale serve --bg --https=443 http://127.0.0.1:$Port
       tailscale serve status      # 确认名字与 -TailscaleName 一致

  4. 启动一次并抓取配对令牌：
       New-Item -ItemType Directory -Force -Path (Split-Path "$LogPath") | Out-Null
       dsh web --host 127.0.0.1 --port $Port --no-open --trusted-host $TailscaleName *> "$LogPath"
     日志里找带 ?token= 的 URL，手机首次配对时粘贴。
     （令牌每次重启都变，但换来的 cookie 跨重启有效 —— 只需配对一次）

  5. 手机浏览器验证：https://$TailscaleName/

  6. 安全验证（别跳过）：
       - 关掉手机 Tailscale 后应连不上
       - 局域网内其它设备访问 http://<本机局域网IP>:$Port 应【连接被拒绝】
       - 本机 netstat -ano | findstr $Port 只应看到 127.0.0.1:$Port，
         不应出现 0.0.0.0:$Port
"@

Write-Host $nextSteps
Write-Host "`n✅ 安装完成" -ForegroundColor Green
