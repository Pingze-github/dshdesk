#!/usr/bin/env bash
# Install the daily marketplace retry as a Windows Task Scheduler entry.
# WSL has no cron/systemd in this deployment, so the task runs wsl.exe through
# a hidden VBS wrapper. The market-submit script deletes this task after a
# successful (or already existing) catalog PR.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_HOME="${WIN_HOME:-/mnt/c/Users/pingze}"
DISTRO="${DSHDESK_WSL_DISTRO:-debian11}"
RUN_AT="${DSHDESK_TASK_TIME:-19:30}"
TASK_NAME="dshdesk-market-submit"
CMD_WIN='C:\Users\pingze\.dsh\dshdesk-market-submit.cmd'
VBS_WIN='C:\Users\pingze\.dsh\dshdesk-market-submit.vbs'
LOG_WIN='C:\Users\pingze\.dsh\dshdesk-market-submit.log'

mkdir -p "$WIN_HOME/.dsh"
cat > "$WIN_HOME/.dsh/dshdesk-market-submit.cmd" <<CMD
@echo off
wsl.exe -d ${DISTRO} -u root -- ${ROOT}/scripts/market-submit.sh >> "${LOG_WIN}" 2>&1
CMD
cat > "$WIN_HOME/.dsh/dshdesk-market-submit.vbs" <<VBS
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd.exe /c \"${CMD_WIN}\"", 0, False
VBS

REG="$(mktemp /tmp/dshdesk-task-XXXX.ps1)"
cat > "$REG" <<PS
\$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${VBS_WIN}"'
\$first = (Get-Date).AddHours(25)
\$trigger = New-ScheduledTaskTrigger -Daily -At \$first
\$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action \$action -Trigger \$trigger -Settings \$settings -Force | Out-Null
PS
chmod 644 "$REG"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(wslpath -w "$REG")"
rm -f "$REG"
echo "installed $TASK_NAME daily, first run in 25h (around $RUN_AT)"
schtasks.exe /Query /TN "$TASK_NAME" /V /FO LIST 2>/dev/null | iconv -f GBK -t UTF-8 2>/dev/null | grep -E '任务名|TaskName|下次运行|Next Run|状态|Status' | head -10 || true
