#!/usr/bin/env bash
# Run one astra task (gpt-6-astra through the Codex CLI) in a checkout, in the background of the caller.
# Usage: astra-run.sh <checkout> <prompt-file> <reply-file> [effort] [resume-session-id]
# Writes <reply-file> (astra's last message), <reply-file>.log (the run) and <reply-file>.session
# (its session id, for `resume`). When astra stops on a usage limit it pings @everyone on Discord,
# at most once every 30 minutes (the owner resets the limit).
set -uo pipefail

dir=$1 prompt=$2 reply=$3 effort=${4:-high} resume=${5:-}
here="$(cd "$(dirname "$0")" && pwd)"
log="$reply.log"

args=(exec --skip-git-repo-check -C "$dir" -s workspace-write
  -c 'sandbox_workspace_write.network_access=true'
  --add-dir /Users/dang/.cache --add-dir /Users/dang/Library/pnpm --add-dir /Users/dang/Library/Caches
  --add-dir /private/tmp
  -c "model_reasoning_effort=\"$effort\"" -m gpt-6-astra -o "$reply")
if [ -n "$resume" ]; then args+=(resume "$resume"); fi
args+=(-)

codex "${args[@]}" < "$prompt" > "$log" 2>&1
code=$?

sid=$(grep -m1 -o -E 'session id: [0-9a-f-]+' "$log" | awk '{print $3}')
[ -n "$sid" ] && echo "$sid" > "$reply.session"

# Only the run's own closing lines can carry the limit error; earlier lines are command output.
if tail -n 40 "$log" | grep -q -i -E "hit your usage limit|usage limit (reached|exceeded)|rate limit reached|insufficient_quota|exceeded your current quota"; then
  stamp=/private/tmp/tassel-astra-limit.stamp
  now=$(date +%s)
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge 1800 ]; then
    echo "$now" > "$stamp"
    reason=$(tail -n 40 "$log" | grep -i -m1 -E "usage limit|rate limit|quota" | cut -c1-200)
    DISCORD_PING_EVERYONE=1 "$here/discord-post.sh" "@everyone astra (gpt-6-astra through the Codex CLI) is out of credit. Its tasks are paused until the limit is reset. Codex says: $reason" || true
  fi
  echo "ASTRA_LIMIT" >> "$log"
  exit 75
fi
exit $code
