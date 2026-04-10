#!/bin/bash
BOT_TOKEN="$1"
CHAT_ID="$2"
MESSAGE="$3"
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  --data-urlencode "parse_mode=Markdown" > /dev/null
