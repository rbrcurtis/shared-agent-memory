#!/bin/bash
set -ex

# Backfill entity tags for all memories using ollama qwen3:8b + Qdrant POST (merge)
# Safety: POST /collections/{name}/points/payload MERGES fields, preserving all existing data
# NEVER use PUT which replaces the entire payload

QDRANT_URL="${1:?Usage: backfill-entities.sh <qdrant_url> <api_key>}"
API_KEY="${2:?Usage: backfill-entities.sh <qdrant_url> <api_key>}"
DRY_RUN="${DRY_RUN:-false}"

node --experimental-strip-types "$(dirname "$0")/backfill-entities-worker.ts" "$QDRANT_URL" "$API_KEY" "$DRY_RUN"
