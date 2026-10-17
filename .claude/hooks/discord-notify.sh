#!/usr/bin/env bash
# Posts "waiting on you" and "stopped on an error" notices to the team's Discord.
# Called by Claude Code hooks with the hook payload JSON on stdin.
# Usage: discord-notify.sh notification|stop-failure
set -u

here="$(cd "$(dirname "$0")" && pwd)"
url="$(tr -d '[:space:]' < "$here/.discord-webhook" 2>/dev/null)"
[ -n "$url" ] || exit 0

event="${1:-notification}"
stamp_file="$here/.last-idle-post"

body="$(python3 -c '
import json, sys, time, os
event, stamp_file = sys.argv[1], sys.argv[2]
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
if event == "notification":
    kind = str(d.get("notification_type") or "")
    text = str(d.get("message") or "Claude is waiting for input")
    if "idle" in kind or "waiting for your input" in text.lower():
        # Idle reminders repeat; post at most one every 10 minutes.
        try:
            if time.time() - os.path.getmtime(stamp_file) < 600:
                sys.exit(0)
        except OSError:
            pass
        open(stamp_file, "w").close()
    line = "⏸️ **Waiting on the user**" + (f" ({kind})" if kind else "") + f": {text}"
else:
    err = d.get("error") or d.get("reason") or d.get("message") or d.get("stop_reason") or "unknown error"
    if isinstance(err, dict):
        err = err.get("message") or json.dumps(err)
    line = f"⚠️ **Claude stopped on an error:** {str(err)[:400]}. If it is a usage limit, work resumes when the limit resets."
print(json.dumps({"username": "Claude · Tassel build", "content": line[:1990], "allowed_mentions": {"parse": []}}))
' "$event" "$stamp_file")" || exit 0
[ -n "$body" ] || exit 0

curl -sS -m 10 -o /dev/null -H 'Content-Type: application/json' -d "$body" "$url"
