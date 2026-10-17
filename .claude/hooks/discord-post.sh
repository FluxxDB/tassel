#!/usr/bin/env bash
# Post a status update (and optional images) to the supervisors' Discord channel.
# Usage: discord-post.sh "message text" [image.png ...]   (max 10 images per post)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
url="$(tr -d '[:space:]' < "$here/.discord-webhook")"
msg="${1:-}"
shift || true

payload="$(python3 -c 'import json, sys
text = sys.argv[1]
if len(text) > 1990:
    text = text[:1987] + "..."
print(json.dumps({"username": "Claude · Tassel build", "content": text, "allowed_mentions": {"parse": []}}))' "$msg")"

if [ "$#" -eq 0 ]; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$payload" "$url?wait=true")
else
  args=(--form-string "payload_json=$payload")
  i=0
  for f in "$@"; do
    args+=(-F "files[$i]=@$f")
    i=$((i + 1))
  done
  code=$(curl -sS -o /dev/null -w '%{http_code}' "${args[@]}" "$url?wait=true")
fi

case "$code" in
  2??) echo "posted ($code)" ;;
  *) echo "discord post failed: HTTP $code" >&2; exit 1 ;;
esac
