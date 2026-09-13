#!/usr/bin/env bash
#
# Mac 侧发布助手。
#
#   deploy/mac/release.sh "提交说明"                    # 日常：自检 → 测试 → 提交 → 推送
#   deploy/mac/release.sh "发布说明" --publish [patch]  # 发布：再 bump 版本 + 同步 PLUGIN_VERSION + 打 tag + 推送
#
# 「发布」与「日常提交」的区别：发布会产生一个 git tag，Windows host 用
# `git ls-remote --tags` 自动解析最新版本，不需要你手工搬 SHA。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

REMOTE_URL="git+ssh://git@github.com/softjava2026/dsh-personal-assistant.git"
BRANCH="main"

MSG=""
PUBLISH=""
BUMP="patch"

while [ $# -gt 0 ]; do
  case "$1" in
    --publish)
      PUBLISH=1
      if [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then BUMP="$2"; shift; fi
      shift
      ;;
    -*)
      echo "未知参数: $1" >&2; exit 2
      ;;
    *)
      if [ -z "$MSG" ]; then MSG="$1"; else echo "多余参数: $1" >&2; exit 2; fi
      shift
      ;;
  esac
done

if [ -z "$MSG" ]; then
  cat >&2 <<'USAGE'
用法:
  deploy/mac/release.sh "提交说明"
  deploy/mac/release.sh "发布说明" --publish [patch|minor|major]
USAGE
  exit 2
fi

case "$BUMP" in
  patch|minor|major) ;;
  *) echo "bump 只能是 patch / minor / major，收到: $BUMP" >&2; exit 2 ;;
esac

# ------------------------------------------------------------------ 1. 自检
echo "▶ 1/5 语法检查 + 版本一致性"
npm run check

# ------------------------------------------------------------------ 2. 测试
echo
echo "▶ 2/5 冒烟测试"
npm test

# ------------------------------------------------------------------ 3. 发布前 bump
NEW_VER=""
if [ -n "$PUBLISH" ]; then
  echo
  echo "▶ 3/5 发布准备：bump $BUMP"

  # 版本号在两处：package.json 的 version 和 config.mjs 的 PLUGIN_VERSION，
  # 由 `npm run check` 强制一致。npm version 只会改前者，必须同步后者，
  # 否则打出来的 tag 在 CI 上直接红。
  NEW_VER="$(npm version "$BUMP" --no-git-tag-version)"
  NEW_VER="${NEW_VER#v}"

  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const before = readFileSync('config.mjs', 'utf8');
    const after = before.replace(/PLUGIN_VERSION = \"[^\"]+\"/, 'PLUGIN_VERSION = \"$NEW_VER\"');
    if (after === before) throw new Error('config.mjs 里没找到 PLUGIN_VERSION，未做替换');
    writeFileSync('config.mjs', after);
  "
  echo "  package.json + config.mjs → v$NEW_VER"

  # 立刻复检，确保两者真的一致 —— 不一致就不该产生 tag
  npm run check
else
  echo
  echo "▶ 3/5 跳过（日常提交，非发布）"
fi

# ------------------------------------------------------------------ 4. 提交
echo
echo "▶ 4/5 提交"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "$MSG"
else
  echo "  （工作区干净，跳过提交）"
fi

if [ -n "$NEW_VER" ]; then
  git tag -a "v$NEW_VER" -m "$MSG"
  echo "  已打 tag v$NEW_VER"
fi

# ------------------------------------------------------------------ 5. 推送
echo
echo "▶ 5/5 推送 origin/$BRANCH"
git push origin "$BRANCH"
if [ -n "$NEW_VER" ]; then
  git push origin "v$NEW_VER"
fi
SHA="$(git rev-parse HEAD)"

# ------------------------------------------------------------------ 收尾
if [ -n "$NEW_VER" ]; then
  cat <<EOF

✅ 已发布 v${NEW_VER}（${SHA}）

──────────────────────────────────────────────────────────────
Windows host 上升级（自动解析最新 tag，无需手工搬 SHA）：

  .\deploy\windows\update-plugin.ps1

指定版本：

  .\deploy\windows\update-plugin.ps1 -Version v${NEW_VER}
──────────────────────────────────────────────────────────────
EOF
else
  cat <<EOF

✅ 已推送 ${SHA}（未发布 tag，Windows 侧不会自动升级）

需要发布时：
  deploy/mac/release.sh "发布说明" --publish patch

──────────────────────────────────────────────────────────────
若要按确切 commit 部署（跳过 tag 流程）：

  dsh plugin --profile web add "${REMOTE_URL}#${SHA}"
──────────────────────────────────────────────────────────────
EOF
fi
