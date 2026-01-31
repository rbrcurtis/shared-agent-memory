#!/bin/bash
set -ex

# Kill existing daemon
pkill -f "memory-mcp.*daemon" 2>/dev/null || true
pkill -f "shared-memory.*daemon" 2>/dev/null || true

# Remove stale socket
rm -f /tmp/shared-memory.sock

# Clear log
> /tmp/shared-memory-daemon.log

echo "Daemon stopped and socket cleaned up"
echo "Daemon will auto-start on next MCP request"
