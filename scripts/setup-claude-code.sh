#!/usr/bin/env bash
set -e

TRACE=1
for arg in "$@"; do
  if [ "$arg" = "--memory-api-key" ]; then
    TRACE=0
    break
  fi
done

if [ "$TRACE" = "1" ]; then
  set -x
fi

SCOPE="user"
SOURCE="rbrcurtis/shared-agent-memory"
MEMORY_API_URL=""
MEMORY_API_KEY=""
DEFAULT_AGENT="claude-code"
DEFAULT_PROJECT=""

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
    --memory-api-url)
      MEMORY_API_URL="$2"
      shift 2
      ;;
    --memory-api-key)
      MEMORY_API_KEY="$2"
      shift 2
      ;;
    --default-agent)
      DEFAULT_AGENT="$2"
      shift 2
      ;;
    --default-project)
      DEFAULT_PROJECT="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/setup-claude-code.sh [--scope user|project|local] [--source owner/repo|path] [--local]
                                    [--memory-api-url url] [--memory-api-key key]
                                    [--default-agent name] [--default-project name]

Adds the shared-agent-memory Claude Code marketplace and installs its plugin.
Claude Code will prompt for plugin options when the plugin is enabled:
MEMORY_API_URL, MEMORY_API_KEY, DEFAULT_AGENT, and optional DEFAULT_PROJECT.

Options:
  --scope   Marketplace and plugin install scope. Default: user
  --source  Marketplace source. Default: rbrcurtis/shared-agent-memory
  --local   Use this checkout as the marketplace source
  --memory-api-url  Memory API URL to write into Claude plugin config
  --memory-api-key  Memory API key to write into Claude plugin config
  --default-agent   Default agent for new memories. Default: claude-code
  --default-project Default project override for new memories
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

if [ -n "$MEMORY_API_URL" ] || [ -n "$MEMORY_API_KEY" ] || [ -n "$DEFAULT_PROJECT" ]; then
  if [ "$SCOPE" != "project" ]; then
    echo "Config args currently write shared project settings; pass --scope project" >&2
    exit 1
  fi

  if [ -z "$MEMORY_API_URL" ] || [ -z "$MEMORY_API_KEY" ]; then
    echo "--memory-api-url and --memory-api-key are both required when writing plugin config" >&2
    exit 1
  fi

  mkdir -p .claude
  MEMORY_API_URL="$MEMORY_API_URL" \
  MEMORY_API_KEY="$MEMORY_API_KEY" \
  DEFAULT_AGENT="$DEFAULT_AGENT" \
  DEFAULT_PROJECT="$DEFAULT_PROJECT" \
  SOURCE="$SOURCE" \
  MARKETPLACE="shared-agent-memory" \
  node --input-type=module <<'EOF'
import fs from 'node:fs';
import path from 'node:path';

const file = '.claude/settings.json';
const pluginId = 'shared-agent-memory@shared-agent-memory';
const marketplace = process.env.MARKETPLACE;
const source = process.env.SOURCE;

let settings = {};
if (fs.existsSync(file)) {
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
}

const sourceConfig = path.isAbsolute(source)
  ? { source: 'directory', path: source }
  : { source: 'github', repo: source };

settings.extraKnownMarketplaces = {
  ...(settings.extraKnownMarketplaces ?? {}),
  [marketplace]: {
    source: sourceConfig,
  },
};

settings.enabledPlugins = {
  ...(settings.enabledPlugins ?? {}),
  [pluginId]: true,
};

settings.pluginConfigs = {
  ...(settings.pluginConfigs ?? {}),
  [pluginId]: {
    ...((settings.pluginConfigs ?? {})[pluginId] ?? {}),
    options: {
      ...(((settings.pluginConfigs ?? {})[pluginId] ?? {}).options ?? {}),
      memory_api_url: process.env.MEMORY_API_URL,
      memory_api_key: process.env.MEMORY_API_KEY,
      default_agent: process.env.DEFAULT_AGENT,
      default_project: process.env.DEFAULT_PROJECT,
    },
  },
};

fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
EOF
fi
