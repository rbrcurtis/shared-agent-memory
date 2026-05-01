#!/usr/bin/env bash
set -ex

SCOPE="user"
SOURCE="rbrcurtis/shared-agent-memory"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    --source)
      SOURCE="$2"
      shift 2
      ;;
    --local)
      SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/setup-claude-code.sh [--scope user|project|local] [--source owner/repo|path] [--local]

Adds the shared-agent-memory Claude Code marketplace and installs its plugin.
Claude Code will prompt for plugin options when the plugin is enabled:
MEMORY_API_URL, MEMORY_API_KEY, DEFAULT_AGENT, and optional DEFAULT_PROJECT.

Options:
  --scope   Marketplace and plugin install scope. Default: user
  --source  Marketplace source. Default: rbrcurtis/shared-agent-memory
  --local   Use this checkout as the marketplace source
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

claude plugin validate "$ROOT"

SCOPE="$SCOPE" SOURCE="$SOURCE" "$ROOT/install.sh"
