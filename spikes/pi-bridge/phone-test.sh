#!/bin/sh
# Runs on the phone (for example in Termux). Reaches the bridge the way the app
# would: read bridge.json over SSH, open an SSH tunnel to the bridge's
# 127.0.0.1 port, and talk to it through the tunnel.
# Usage: sh phone-test.sh [user@host] [bridge-state-dir]
set -e
HOST=${1:-mars@devbox}
DIR=${2:-/tmp/pi-bridge-spike/state}
LOCAL_PORT=8787

JSON=$(ssh "$HOST" cat "$DIR/bridge.json")
PORT=$(echo "$JSON" | sed 's/.*"port":\([0-9]*\).*/\1/')
TOKEN=$(echo "$JSON" | sed 's/.*"token":"\([0-9a-f]*\)".*/\1/')
echo "bridge on $HOST, remote port $PORT"

ssh -N -o ExitOnForwardFailure=yes -L "$LOCAL_PORT:127.0.0.1:$PORT" "$HOST" &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT
sleep 3

URL="http://127.0.0.1:$LOCAL_PORT"
AUTH="Authorization: Bearer $TOKEN"

echo "--- 1. state"
curl -s -H "$AUTH" "$URL/state"; echo
echo "--- 2. send a message"
curl -s -H "$AUTH" -H "content-type: application/json" \
	-d '{"text":"This message comes from the phone. Reply with exactly: HELLO-FROM-PHONE"}' "$URL/message"; echo
echo "--- 3. live events for 15 seconds"
curl -s -N --max-time 15 -H "$AUTH" "$URL/events" | grep '^data' | grep -v text_delta || true
echo "--- 4. last messages in history"
curl -s -H "$AUTH" "$URL/history" | tail -c 300; echo
