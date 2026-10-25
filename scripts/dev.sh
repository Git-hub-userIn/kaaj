#!/usr/bin/env bash

# Kaaj Local Development Orchestrator (Bash)
# Starts backend and UI servers, and terminates all child processes on Ctrl+C.

cleanup() {
  echo ""
  echo -e "\033[33m[kaaj] Shutting down Kaaj services...\033[0m"
  # Terminate all child jobs
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
  echo -e "\033[32m[kaaj] All services stopped cleanly.\033[0m"
}

trap cleanup INT TERM EXIT

echo -e "\033[36m[kaaj]\033[0m Starting API (http://localhost:3001) and Web UI (http://localhost:3000)..."
echo -e "\033[90m[kaaj] Press Ctrl+C to stop both servers.\033[0m"
echo ""

bun run --filter @kaaj/api dev &
bun run --filter @kaaj/web dev &

# Wait for background jobs
wait
