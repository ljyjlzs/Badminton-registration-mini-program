#!/usr/bin/env bash
set -euo pipefail
TAG=${1:?用法: rollback-fn.sh <tag>}
PREV=$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || git rev-list --max-parents=0 HEAD)
echo "对比: ${PREV} -> ${TAG}"
echo "需要在微信开发者工具重新上传的云函数:"
git diff --name-only "$PREV" "$TAG" -- 'badminton-app/cloudfunctions/*' \
  | sed -E 's#badminton-app/cloudfunctions/([^/]+)/.*#\1#' | sort -u
