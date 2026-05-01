#!/usr/bin/env bash
set -ex

SCOPE="${SCOPE:-user}"
SOURCE="${SOURCE:-rbrcurtis/shared-agent-memory}"
MARKETPLACE="${MARKETPLACE:-shared-agent-memory}"
PLUGIN="${PLUGIN:-shared-agent-memory}"
PLUGIN_ID="$PLUGIN@$MARKETPLACE"

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
    --marketplace)
      MARKETPLACE="$2"
      PLUGIN_ID="$PLUGIN@$MARKETPLACE"
      shift 2
      ;;
    --plugin)
      PLUGIN="$2"
      PLUGIN_ID="$PLUGIN@$MARKETPLACE"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage: install.sh [--scope user|project|local] [--source owner/repo|path|url]

Installs the shared-agent-memory Claude Code marketplace and plugin.

Environment overrides:
  SCOPE        Install scope. Default: user
  SOURCE       Marketplace source. Default: rbrcurtis/shared-agent-memory
  MARKETPLACE  Marketplace name. Default: shared-agent-memory
  PLUGIN       Plugin name. Default: shared-agent-memory

Examples:
  curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | SCOPE=project bash
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI is required: claude" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for Claude Code plugin setup" >&2
  exit 1
fi

if claude plugin marketplace list --json | node -e "const fs = require('fs'); const items = JSON.parse(fs.readFileSync(0, 'utf8')); const name = process.argv[1]; process.exit(items.some((item) => item.name === name) ? 0 : 1);" "$MARKETPLACE"; then
  claude plugin marketplace update "$MARKETPLACE"
else
  claude plugin marketplace add "$SOURCE" --scope "$SCOPE"
fi

if claude plugin list --json | node -e "const fs = require('fs'); const items = JSON.parse(fs.readFileSync(0, 'utf8')); const scope = process.argv[1]; const id = process.argv[2]; process.exit(items.some((item) => item.id === id && item.scope === scope) ? 0 : 1);" "$SCOPE" "$PLUGIN_ID"; then
  claude plugin update "$PLUGIN_ID" --scope "$SCOPE"
else
  claude plugin install "$PLUGIN_ID" --scope "$SCOPE"
fi

if claude plugin list --json | node -e "const fs = require('fs'); const items = JSON.parse(fs.readFileSync(0, 'utf8')); const scope = process.argv[1]; const id = process.argv[2]; process.exit(items.some((item) => item.id === id && item.scope === scope && item.enabled === false) ? 0 : 1);" "$SCOPE" "$PLUGIN_ID"; then
  claude plugin enable "$PLUGIN_ID" --scope "$SCOPE"
fi
