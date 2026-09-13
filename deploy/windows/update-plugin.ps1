<#
.SYNOPSIS
  把 Windows host 上的 dsh-personal-assistant 更新到指定 commit，并重启 dsh web。

.DESCRIPTION
  日常更新用。对应 deploy/README.md 第 3 节。

  为什么不用 `dsh plugin update`：依赖被钉在确切 SHA 上，`update` 不会移动它。
  必须用新的 SHA 重新 `add`。

.NOTES
  ⚠️ 本脚本尚未在真实 Windows 上实测（编写环境是 macOS）。
     首次使用建议先手动逐条执行 deploy/README.md 第 3 节的命令并核对输出。

.EXAMPLE
  .\update-plugin.ps1 -Sha fdb927abd162c93234cca713a5ef3ffd965a678f
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Sha,

  [string]$Profile  = "web",
  [string]$Repo     = "git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git",
  [string]$TaskName = "dsh-web-host"
)

$ErrorActionPreference = "Stop"

# 短 SHA 也接受，但提示一下完整 SHA 更利于追溯
if ($Sha.Length -lt 40) {
  Write-Warning "传入的是短 SHA ($Sha)。建议用完整 40 位 SHA，便于追溯与回滚。"
}

Write-Host "▶ 1/3 安装 $Sha" -ForegroundColor Cyan
& dsh plugin --profile $Profile add "$Repo#$Sha"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败（exit $LASTEXITCODE）" }

Write-Host "▶ 2/3 校验插件层确实被识别" -ForegroundColor Cyan
# 原生命令的 stderr 配合 $ErrorActionPreference='Stop' 会抛 NativeCommandError，
# 这里临时放宽，改由下面的字符串匹配来判断成败。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$dump = (& dsh --profile $Profile --dump-config 2>&1 | Out-String)
$ErrorActionPreference = $prevEap
if ($dump -notmatch "personal-assistant") {
  throw "dump-config 输出里没有 personal-assistant —— 安装没生效，已中止（未重启服务）"
}
Write-Host "  ✅ 插件层已注册" -ForegroundColor Green

Write-Host "▶ 3/3 重启 host" -ForegroundColor Cyan
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask  -TaskName $TaskName
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "  ✅ 已重启计划任务 $TaskName" -ForegroundColor Green
} else {
  Write-Warning "没找到计划任务 $TaskName（见 README §2.10）—— 请手工重启 dsh web"
}

Write-Host ""
Write-Host "完成。建议到手机上确认对话仍可用。" -ForegroundColor Green
