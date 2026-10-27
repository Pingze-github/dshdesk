#!/usr/bin/env bash
# Submit dshdesk to the awesome-dsh-plugin catalog, retry once per day.
#
# Requirements checked here (and by the catalog CI):
#   - repository is at least 24 hours old;
#   - `dsh-plugin` topic is present;
#   - package.json declares `dsh.bundle.patch`;
#   - exactly one YAML entry is added under data/plugins/.
#
# Every run pushes one Bark result, success or failure. On a successful or
# already-existing PR the Windows scheduled task is deleted so the retry loop
# stops. `--dry` performs all read-only checks and prints the plan without
# touching GitHub or Bark.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OWNER="${DSHDESK_OWNER:-Pingze-github}"
REPO="${DSHDESK_REPO:-dshdesk}"
CATALOG_OWNER="awesome-dsh-plugin"
CATALOG_REPO="awesome-dsh-plugin"
BRANCH="dshdesk-marketplace"
ENTRY="data/plugins/${OWNER}__${REPO}.yml"
TASK_NAME="dshdesk-market-submit"
STATE="$ROOT/.market-submit-state.json"
DRY=0
[ "${1:-}" = "--dry" ] && DRY=1
NOTIFIED=0

load_bark() {
  local conf="${BARK_CONF:-/mnt/c/Users/pingze/.workbuddy/notify.conf}"
  [ -f "$conf" ] || return 0
  # Only BARK_* lines are imported: the same file also contains unquoted
  # event lists that are not valid shell assignments.
  while IFS='=' read -r key value; do
    case "$key" in
      BARK_BASE|BARK_KEY|BARK_GROUP|BARK_SOUND|BARK_LEVEL)
        export "$key=$value"
        ;;
    esac
  done < <(grep -E '^BARK_(BASE|KEY|GROUP|SOUND|LEVEL)=' "$conf" 2>/dev/null || true)
}

notify() {
  local ok="$1" message="$2" url="${3:-}"
  [ "$DRY" = "1" ] && { echo "notify[$ok]: $message ${url:+($url)}"; return 0; }
  load_bark
  if [ -z "${BARK_BASE:-}" ] || [ -z "${BARK_KEY:-}" ]; then
    echo "market-submit: Bark is not configured; result: $message" >&2
    return 0
  fi
  local stamp title level payload http
  stamp="$(date '+%m-%d')"
  if [ "$ok" = "ok" ]; then
    title="📦 dshdesk 上架 · ✅ 已提交 · ${stamp}"
    level="active"
  else
    title="📦 dshdesk 上架 · ❌ 失败 · ${stamp}"
    level="timeSensitive"
  fi
  payload="$(python3 - "$title" "$message" "$url" "$level" <<'PY'
import json, sys
title, message, url, level = sys.argv[1:5]
body = message
if url:
    body += "\n" + url
print(json.dumps({
    "title": title,
    "body": body,
    "group": "dshdesk",
    "sound": "bell",
    "level": level,
    "isArchive": 1,
    **({"url": url} if url else {}),
}, ensure_ascii=False))
PY
)"
  http="$(curl -sS --max-time 25 -o /tmp/dshdesk-bark.json -w '%{http_code}' \
    -H 'content-type: application/json' -X POST --data-binary "$payload" \
    "${BARK_BASE%/}/${BARK_KEY}" 2>/dev/null || true)"
  if [ "$http" = "200" ] && grep -q '"code":200' /tmp/dshdesk-bark.json 2>/dev/null; then
    echo "market-submit: Bark delivered"
  else
    echo "market-submit: Bark delivery failed (HTTP ${http:-none})" >&2
  fi
}

write_state() {
  [ "$DRY" = "1" ] && return 0
  python3 - "$STATE" "$1" "$2" "${3:-}" <<'PY'
import json, sys, time
path, status, message, url = sys.argv[1:5]
with open(path, "w", encoding="utf-8") as fh:
    json.dump({"status": status, "message": message, "url": url, "at": int(time.time())}, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
}

remove_task() {
  [ "$DRY" = "1" ] && return 0
  [ "${DSHDESK_KEEP_SCHEDULE:-0}" = "1" ] && return 0
  schtasks.exe /Delete /TN "$TASK_NAME" /F >/dev/null 2>&1 || true
}

finish() {
  local ok="$1" message="$2" url="${3:-}"
  NOTIFIED=1
  write_state "$ok" "$message" "$url"
  echo "market-submit: $message"
  notify "$ok" "$message" "$url"
  if [ "$ok" = "ok" ]; then
    remove_task
    exit 0
  fi
  exit 1
}

trap 'if [ "$NOTIFIED" -eq 0 ]; then finish fail "脚本在第 $LINENO 行异常退出"; fi' ERR

if ! command -v gh >/dev/null 2>&1; then
  finish fail "找不到 gh CLI"
fi
if ! gh auth status >/dev/null 2>&1; then
  finish fail "gh 未登录"
fi

echo "market-submit: reading $OWNER/$REPO"
REPO_JSON="$(gh repo view "$OWNER/$REPO" --json createdAt,url,repositoryTopics 2>/dev/null)" || finish fail "读取仓库失败（$OWNER/$REPO）"
CREATED="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["createdAt"])' <<<"$REPO_JSON")"
REPO_URL="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])' <<<"$REPO_JSON")"
AGE_HOURS="$(python3 - "$CREATED" <<'PY'
import datetime, sys
try:
    created = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
except Exception:
    print(0); raise SystemExit
print(int((datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() // 3600))
PY
)"
echo "market-submit: repo age ${AGE_HOURS}h"
if [ "$AGE_HOURS" -lt 24 ]; then
  finish fail "仓库创建未满 24 小时（已 ${AGE_HOURS}h），下次定时任务重试" "$REPO_URL"
fi

echo "market-submit: ensuring topics"
if [ "$DRY" = "0" ]; then
  gh repo edit "$OWNER/$REPO" --add-topic dsh-plugin --add-topic deepseek-harness --add-topic dsh >/dev/null 2>&1 || true
fi

echo "market-submit: checking package manifest"
PKG="$(gh api "repos/$OWNER/$REPO/contents/package.json" --jq .content 2>/dev/null | base64 -d 2>/dev/null || true)"
[ -n "$PKG" ] || finish fail "读取 package.json 失败" "$REPO_URL"
python3 - "$PKG" <<'PY' || finish fail "package.json 缺少 dsh.bundle.patch 或名字不符" "$REPO_URL"
import json, sys
pkg = json.loads(sys.argv[1])
assert pkg.get("name") == "dshdesk", pkg.get("name")
assert pkg.get("dsh", {}).get("bundle", {}).get("patch") == "./cordis.patch.yml"
PY

echo "market-submit: checking existing PRs"
PRS="$(gh pr list --repo "$CATALOG_OWNER/$CATALOG_REPO" --head "$OWNER:$BRANCH" --state all --json number,url,state,title --limit 10 2>/dev/null || echo '[]')"
EXISTING="$(python3 - "$PRS" <<'PY'
import json, sys
rows = json.loads(sys.argv[1] or "[]")
for row in rows:
    if row.get("state") in ("OPEN", "MERGED"):
        print(f'{row["state"]}\t{row["url"]}')
        break
PY
)"
if [ -n "$EXISTING" ]; then
  STATE_NAME="${EXISTING%%$'\t'*}"
  PR_URL="${EXISTING#*$'\t'}"
  if [ "$STATE_NAME" = "MERGED" ]; then
    finish ok "目录 PR 已合并，dshdesk 已在插件市场中" "$PR_URL"
  fi
  finish ok "目录 PR 已存在（$STATE_NAME），无需重复提交" "$PR_URL"
fi

if [ "$DRY" = "1" ]; then
  echo "market-submit: dry run — would sync fork, create $ENTRY, and open a PR"
  finish ok "dry run 通过（仓库已满 ${AGE_HOURS}h）" "$REPO_URL"
fi

echo "market-submit: syncing fork"
if ! gh api "repos/$OWNER/$CATALOG_REPO" >/dev/null 2>&1; then
  gh repo fork "$CATALOG_OWNER/$CATALOG_REPO" --clone=false >/dev/null 2>&1 || finish fail "创建/读取 fork 失败" "$REPO_URL"
fi
gh repo sync "$OWNER/$CATALOG_REPO" --source "$CATALOG_OWNER/$CATALOG_REPO" --branch main >/dev/null 2>&1 || \
  gh repo sync "$OWNER/$CATALOG_REPO" --source "$CATALOG_OWNER/$CATALOG_REPO" --branch main --force >/dev/null 2>&1 || \
  finish fail "同步 fork 失败" "$REPO_URL"

BASE="$(gh api "repos/$OWNER/$CATALOG_REPO/git/ref/heads/main" --jq .object.sha 2>/dev/null)" || finish fail "读取 fork main 失败" "$REPO_URL"
gh api -X DELETE "repos/$OWNER/$CATALOG_REPO/git/refs/heads/$BRANCH" >/dev/null 2>&1 || true
gh api -X POST "repos/$OWNER/$CATALOG_REPO/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$BASE" >/dev/null 2>&1 || finish fail "创建 fork 分支失败" "$REPO_URL"

read -r -d '' YAML <<YAML || true
url: https://github.com/${OWNER}/${REPO}
name: ${OWNER}/${REPO}
category: ui
description:
  en: 'A read-only attention board that folds every DSH session into Needs you, In progress, Review and Done, derived from the harness status facts. A footer button opens an 860px live bubble; on a Windows desktop shell it can be pinned into a true 900x620 always-on-top WPF companion that mirrors the board every 800ms and hides the pin in plain browsers. No card is authored, dragged or completed by hand.'
  zh: '只读任务看板：把每个 DSH 会话实时折成「需要你 / 进行中 / 验收 / 完成」四栏，栏位完全由宿主状态推导；侧边栏底部按钮打开 860px 实时气泡，桌面端还能钉成真正的 900x620 Windows 置顶小窗（WPF），每 800ms 镜像主窗、6 秒断线自动关闭，网页端不显示图钉。不拖拽、不手动完成、不写回会话状态。'
YAML
B64="$(printf '%s' "$YAML" | base64 -w0)"
gh api -X PUT "repos/$OWNER/$CATALOG_REPO/contents/$ENTRY" \
  -f message="Add ${OWNER}/${REPO} to the catalog" \
  -f content="$B64" \
  -f branch="$BRANCH" >/dev/null 2>&1 || finish fail "写入目录条目失败" "$REPO_URL"

PR_URL="$(gh pr create --repo "$CATALOG_OWNER/$CATALOG_REPO" --head "$OWNER:$BRANCH" --base main \
  --title "Add ${OWNER}/${REPO}" \
  --body "Automated catalog entry for [\`${OWNER}/${REPO}\`](${REPO_URL}).

- Read-only four-column attention board for DSH.
- 860px sidebar bubble; web hides the always-on-top pin.
- Windows desktop shell can open a true 900x620 WPF always-on-top companion, 800ms mirror, 6s stale close.
- Gate: \`bash scripts/check.sh\` (13 unit tests + static packaging checks)." 2>/dev/null)" || finish fail "创建 PR 失败（可能是权限或分支问题）" "$REPO_URL"

finish ok "已向 awesome-dsh-plugin 提交目录 PR" "$PR_URL"
