#!/usr/bin/env bash
# dshdesk — runtime verification in one call.
#
#   bash scripts/smoke.sh          gate + live routes + native self-test
#   bash scripts/smoke.sh --gui    …and render the board in headless Chromium
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DSH_HOME="${DSH_HOME:-/root/.dsh}"
BASE="http://127.0.0.1:3080"
JAR="${TMPDIR:-/tmp}/dshdesk-smoke.cookies"
PLUGIN_ID="dshdesk"
GUI=0
[ "${1:-}" = "--gui" ] && GUI=1

token_candidates() {
  local pid log
  for pid in $(ss -ltnp 2>/dev/null | sed -n 's/.*:3080 .*pid=\([0-9]*\).*/\1/p' | sort -u); do
    log="$(readlink -f "/proc/$pid/fd/1" 2>/dev/null || true)"
    [ -n "$log" ] && [ -f "$log" ] || continue
    grep -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' "$log" 2>/dev/null | tail -1 || true
  done
  grep -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' /var/log/dsh-web.log 2>/dev/null | tail -1 || true
}

TOKEN_URL="${DSHDESK_URL:-}"
if [ -z "$TOKEN_URL" ]; then
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    curl -s -L -o /dev/null -c "$JAR" -b "$JAR" "$candidate" || continue
    code=$(curl -s -b "$JAR" -H 'Origin: http://127.0.0.1:3080' -o /dev/null -w '%{http_code}' "$BASE/_dsh/hotswap/state" || true)
    [ "$code" = "200" ] && { TOKEN_URL="$candidate"; break; }
  done < <(token_candidates)
fi
if [ -z "$TOKEN_URL" ]; then
  echo "smoke: no authenticated URL — set DSHDESK_URL" >&2
  exit 2
fi
curl -s -L -o /dev/null -c "$JAR" -b "$JAR" "$TOKEN_URL"
AUTH=(-b "$JAR" -H 'Origin: http://127.0.0.1:3080')

echo "smoke: static gate"
bash scripts/check.sh

echo "smoke: plugin phase ($PLUGIN_ID)"
PHASE=$(curl -s "${AUTH[@]}" "$BASE/_dsh/hotswap/state" | PLUGIN_ID="$PLUGIN_ID" python3 -c '
import json, os, sys
target = os.environ["PLUGIN_ID"]
entries = json.load(sys.stdin)["value"]["entries"]
hit = [e for e in entries if e["id"] == target]
print(hit[0]["phase"] if hit else "missing")
')
if [ "$PHASE" != "active" ]; then
  echo "smoke: $PLUGIN_ID phase is '$PHASE', expected 'active'" >&2
  echo "smoke: install with: dsh plugin --profile web add link:$ROOT" >&2
  exit 1
fi

echo "smoke: capabilities + snapshot + window"
for route in capabilities window; do
  CODE=$(curl -s -b "$JAR" -H 'Origin: http://127.0.0.1:3080' -o "/tmp/dshdesk-$route.json" -w '%{http_code}' "$BASE/dshdesk/$route")
  [ "$CODE" = "200" ] || { echo "smoke: /dshdesk/$route returned $CODE" >&2; exit 1; }
done
SNAPSHOT=$(python3 - <<'PY'
import json
payload = {
  "generatedAt": 1,
  "locale": "zh",
  "currentSessionId": "smoke",
  "theme": {"dark": False, "bg": "#ffffff", "layer1": "#ffffff", "layer2": "#f5f6f7", "sidebar": "#f9fafb", "labelPrimary": "#0f1115", "labelSecondary": "#545557", "labelTertiary": "#81858c", "border": "#0000001a", "accent": "#4176e6", "amber": "#f59e0b", "green": "#22c55e", "idle": "#d4d4d4", "red": "#ec1313"},
  "columns": {"needs": [{"id": "smoke", "title": "冒烟会话", "project": "dshdesk", "updatedAt": 1, "relative": "刚刚", "badge": "待审批", "current": True, "column": "needs"}], "running": [], "review": [], "done": []},
  "counts": {"needs": 1, "running": 0, "review": 0, "done": 0, "total": 1}
}
print(json.dumps(payload, ensure_ascii=False))
PY
)
CODE=$(curl -s -b "$JAR" -H 'Origin: http://127.0.0.1:3080' -H 'content-type: application/json' -X POST -d "$SNAPSHOT" -o /tmp/dshdesk-snapshot.json -w '%{http_code}' "$BASE/dshdesk/snapshot")
[ "$CODE" = "200" ] || { echo "smoke: snapshot returned $CODE" >&2; exit 1; }
python3 - <<'PY'
import json
checks = {
    "/tmp/dshdesk-capabilities.json": ("staleMs", 6000),
    "/tmp/dshdesk-snapshot.json": ("ok", True),
    "/tmp/dshdesk-window.json": ("open", False),
}
for path, (key, expected) in checks.items():
    with open(path) as fh:
        data = json.load(fh)
    if data.get(key) != expected:
        raise SystemExit(f"smoke: {path} {key}={data.get(key)!r}, expected {expected!r}")
print("smoke: JSON invariants OK")
PY

if command -v powershell.exe >/dev/null 2>&1; then
  echo "smoke: native self-test"
  WIN_SCRIPT=$(wslpath -w native/dshdesk-window.ps1)
  OUT=$(timeout 45 powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$WIN_SCRIPT" -SelfTest 2>&1)
  case "$OUT" in
    *SELFTEST_OK*) echo "smoke: $OUT" ;;
    *) echo "smoke: native self-test failed: $OUT" >&2; exit 1 ;;
  esac
else
  echo "smoke: powershell.exe not present; native self-test skipped"
fi

if [ "$GUI" = "1" ]; then
  echo "smoke: GUI render"
  [ -x "$(command -v chromium)" ] || { echo "smoke: chromium missing" >&2; exit 1; }
  node scripts/gui-probe.mjs \
    --url "$TOKEN_URL" \
    --wait '[data-dshdesk-trigger]' \
    --click '[data-dshdesk-trigger]' \
    --force-desktop \
    --size 1500,1000 \
    --timeout 90000 \
    --out shots/board.png > /tmp/dshdesk-gui.json
  python3 - <<'PY'
import json
with open("/tmp/dshdesk-gui.json") as fh:
    result = json.load(fh)
report = result.get("report") or {}
if isinstance(report, str):
    report = json.loads(report)
if report.get("bootFailure"):
    raise SystemExit("smoke: GUI failed to load plugins")
if not report.get("trigger"):
    raise SystemExit(f"smoke: footer trigger missing: {json.dumps(result)[:1200]}")
if not report.get("panel"):
    raise SystemExit(f"smoke: board panel missing: {json.dumps(result)[:1200]}")
ids = [column.get("id") for column in report.get("columns") or []]
if ids != ["needs", "running", "review", "done"]:
    raise SystemExit(f"smoke: columns are {ids!r}")
if not report.get("pin"):
    raise SystemExit("smoke: forced desktop pin button missing")
if result.get("consoleErrors"):
    raise SystemExit(f"smoke: console errors: {result['consoleErrors'][:3]}")
print(f"smoke: GUI OK — {len(report.get('cards') or [])} card(s), screenshot shots/board.png")
PY
fi

echo "smoke: PASS"
