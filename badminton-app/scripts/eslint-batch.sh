#!/usr/bin/env bash
# ENG-05：ESLint 分批 --fix 脚本（每批 10 个文件、改完立刻单独 commit）
# 用法：bash scripts/eslint-batch.sh
# 注意：按对抗验证结论，git add 只加本批文件，不用 git add -A，
#       避免把无关 WIP 与未跟踪的 cloudbaserc.json（含明文 AI_API_KEY）一并提交。
set -e
cd "$(dirname "$0")/.."
mapfile -t FILES < <(find cloudfunctions miniprogram shared tests scripts -name '*.js' -not -path '*/node_modules/*' | sort)
BATCH=10
for ((i=0; i<${#FILES[@]}; i+=BATCH)); do
  batch=("${FILES[@]:i:BATCH}")
  npx eslint --fix "${batch[@]}"
  git add -- "${batch[@]}"
  git commit -m "chore: eslint --fix 批次 $((i/BATCH+1))（${#batch[@]} 文件）"
done
