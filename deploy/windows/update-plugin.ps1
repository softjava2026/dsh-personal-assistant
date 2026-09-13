<#
.SYNOPSIS
  把 Windows host 上的 dsh-personal-assistant 升级到指定版本，缺省自动取最新 tag。

.DESCRIPTION
  对应 deploy/README.md 第 3 节。

  版本解析走 `git ls-remote --tags`，**不需要 clone，也不需要手工把 SHA 从 Mac 搬过来**。

  为什么不用 `dsh plugin update`：依赖被钉在确切的 tag/commit 上，`update` 不会移动它。
  必须用新的 spec 重新 `add`。

.NOTES
  ⚠️ 本脚本尚未在真实 Windows 上实测（编写环境是 macOS，且本机无 pwsh 可做语法校验）。
     首次使用建议先手动执行 deploy/README.md 第 3 节的命令并核对输出。

.EXAMPLE
  .\update-plugin.ps1                      # 升到最新 tag
  .\update-plugin.ps1 -Version v0.2.0      # 升到指定版本
  .\update-plugin.ps1 -Force               # 已是最新也重装
  .\update-plugin.ps1 -NoRestart           # 只换版本，不重启服务
#>
[CmdletBinding()]
param(
  # v0.1.1 或 0.1.1；缺省自动解析最新 tag
  [string]$Version,

  [string]$Profile  = "web",
  [string]$Repo     = "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git",
  [string]$GitUrl   = "git@github.com:softjava2026/dsh-personal-assistant.git",
  [string]$TaskName = "dsh-web-host",

  [switch]$Force,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

# 原生命令的 stderr 配合 $ErrorActionPreference='Stop' 会抛 NativeCommandError
# （git/ssh 把正常信息写 stderr 很常见），这里统一用这个包一层。
function Invoke-Native {
  param([scriptblock]$Command)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try   { & $Command 2>&1 | Out-String }
  finally { $ErrorActionPreference = $prev }
}

# ---------------------------------------------------------------- 1. 解析版本
Write-Host "▶ 1/5 解析目标版本" -ForegroundColor Cyan

if (-not $Version) {
  $raw = Invoke-Native { git ls-remote --tags --refs $GitUrl }
  if ($LASTEXITCODE -ne 0) { throw "git ls-remote 失败。确认本机已配置 GitHub SSH（见 README §2.2）。" }

  $candidates = $raw -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    $tag = ($line -split '\s+')[1] -replace '^refs/tags/', ''
    $bare = $tag -replace '^v', ''
    if ($bare -match '^\d+\.\d+\.\d+$') {
      [pscustomobject]@{ Tag = $tag; Ver = [version]$bare }
    }
  }

  if (-not $candidates) {
    throw "远端没有任何 semver tag。先在 Mac 上执行：deploy/mac/release.sh `"发布说明`" --publish patch"
  }
  $Version = ($candidates | Sort-Object Ver | Select-Object -Last 1).Tag
  Write-Host "  最新 tag：$Version"
} else {
  if ($Version -notmatch '^v') { $Version = "v$Version" }
  Write-Host "  指定版本：$Version"
}

$bareVersion = $Version -replace '^v', ''

# ---------------------------------------------------------------- 2. 比对现状
Write-Host "▶ 2/5 比对当前安装版本" -ForegroundColor Cyan

$installedPkg = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules\dsh-personal-assistant\package.json"
$installed = $null
if (Test-Path $installedPkg) {
  $installed = (Get-Content $installedPkg -Raw | ConvertFrom-Json).version
  Write-Host "  当前已安装：v$installed"
} else {
  Write-Host "  当前未安装（首次部署）"
}

if ($installed -eq $bareVersion -and -not $Force) {
  Write-Host "`n✅ 已经是 $Version，无需升级。（要强制重装加 -Force）" -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- 3. 安装
Write-Host "▶ 3/5 安装 $Version" -ForegroundColor Cyan
& dsh plugin --profile $Profile add "$Repo#$Version"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败（exit $LASTEXITCODE）" }

# ---------------------------------------------------------------- 4. 校验
Write-Host "▶ 4/5 校验插件层确实被识别" -ForegroundColor Cyan
$dump = Invoke-Native { dsh --profile $Profile --dump-config }
if ($dump -notmatch "personal-assistant") {
  throw "dump-config 输出里没有 personal-assistant —— 安装没生效，已中止（未重启服务）"
}
$after = (Get-Content $installedPkg -Raw | ConvertFrom-Json).version
Write-Host "  ✅ 插件层已注册，实际版本 v$after" -ForegroundColor Green

if ($after -ne $bareVersion) {
  Write-Warning "实际落盘版本 v$after 与目标 $bareVersion 不一致，请检查 pnpm 输出"
}

# ---------------------------------------------------------------- 5. 重启
if ($NoRestart) {
  Write-Host "▶ 5/5 跳过重启（-NoRestart）" -ForegroundColor Cyan
} else {
  Write-Host "▶ 5/5 重启 host" -ForegroundColor Cyan
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask  -TaskName $TaskName
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "  ✅ 已重启计划任务 $TaskName" -ForegroundColor Green
  } else {
    Write-Warning "没找到计划任务 $TaskName（见 README §2.10）—— 请手工重启 dsh web"
  }
}

Write-Host "`n完成：v$installed → v$after。建议到手机上确认对话仍可用。" -ForegroundColor Green
