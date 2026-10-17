#!/usr/bin/env bash
# Post a status update (and optional images) to the supervisors' Discord channel.
# Usage: discord-post.sh "message text" [image.png ...]   (max 10 images per post)
# Mentions stay off unless DISCORD_PING_EVERYONE=1, which lets an "@everyone" in the text ping
# (the owner asked for one when testing that spends real provider credits begins).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
url="$(tr -d '[:space:]' < "$here/.discord-webhook")"
msg="${1:-}"
shift || true

payload="$(python3 -c 'import json, sys
text = sys.argv[1]
if len(text) > 1990:
    text = text[:1987] + "..."
mentions = ["everyone"] if sys.argv[2] == "1" else []
print(json.dumps({"username": "Claude · Tassel build", "content": text, "allowed_mentions": {"parse": mentions}}))' "$msg" "${DISCORD_PING_EVERYONE:-0}")"

# HTTP/1.1 and one retry: macOS's LibreSSL curl intermittently fails image uploads with
# "bad record mac". A failure while reading the reply can mean the post already landed,
# so a retry may duplicate it; a duplicate beats a missed update.
curl_opts=(-sS -o /dev/null -w '%{http_code}' --http1.1 --retry 1 --retry-all-errors --retry-delay 2)

if [ "$#" -eq 0 ]; then
  code=$(curl "${curl_opts[@]}" -H 'Content-Type: application/json' -d "$payload" "$url?wait=true")
else
  args=(--form-string "payload_json=$payload")
  i=0
  for f in "$@"; do
    args+=(-F "files[$i]=@$f")
    i=$((i + 1))
  done
  code=$(curl "${curl_opts[@]}" "${args[@]}" "$url?wait=true")
fi

case "$code" in
  2??) echo "posted ($code)" ;;
  *) echo "discord post failed: HTTP $code" >&2; exit 1 ;;
esac
