#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔥 Starting AnkiForge..."

# Start backend
cd "$SCRIPT_DIR/server"
npx ts-node src/index.ts &
SERVER_PID=$!
echo "✅ Server started (PID $SERVER_PID) → http://localhost:3001"

# Start frontend
cd "$SCRIPT_DIR/client"
npx vite --port 5173 &
CLIENT_PID=$!
echo "✅ Client started (PID $CLIENT_PID) → http://localhost:5173"

echo ""
echo "AnkiForge is running at http://localhost:5173"
echo "Press Ctrl+C to stop both servers."

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID $CLIENT_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

wait
