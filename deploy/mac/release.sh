#!/usr/bin/env bash
#
# Mac 侧发布助手：自检 → 测试 → 提交 → 推送 → 打印 Windows 部署命令。
#
# 用法：
#   deploy/mac/release.sh "feat: 加入 xxx"
#
set -euo pipefail

# 仓库根目录（本脚本在 deploy/mac/ 下）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

REMOTE_URL="git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git"
BRANCH="main"

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "用法: deploy/mac/release.sh \"提交说明\"" >&2
  exit 2
fi

echo "▶ 1/4 语法检查 + 版本一致性"
npm run check

echo
echo "▶ 2/4 冒烟测试"
npm test

echo
echo "▶ 3/4 提交"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "$MSG"
else
  echo "  （工作区干净，跳过提交）"
fi

echo
echo "▶ 4/4 推送 origin/$BRANCH"
git push origin "$BRANCH"

SHA="$(git rev-parse HEAD)"

# 把确切 SHA 渲染成 Windows 上可直接粘贴的命令 —— 钉 SHA 而不是分支，
# 这样"Windows 上跑的是哪个版本"永远有确定答案，也能随时回滚。
cat <<EOF

✅ 已推送 $SHA

──────────────────────────────────────────────────────────────
在 Windows host 上执行（钉到上面这个 SHA）：

  dsh plugin --profile web add "$REMOTE_URL#$SHA"

然后重启 host：

  Stop-ScheduledTask  -TaskName "dsh-web-host"
  Start-ScheduledTask -TaskName "dsh-web-host"

或直接用助手脚本：

  deploy\\windows\\update-plugin.ps1 -Sha $SHA
──────────────────────────────────────────────────────────────
EOF
