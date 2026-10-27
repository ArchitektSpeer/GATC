#!/usr/bin/env bash
# Starts builder $2 once the build log of builder $1 has finished (has an EXIT line).
# Usage: scripts/run-after.sh <previous-prompt> <next-prompt>
cd "$(dirname "$0")/.."
until grep -q '^EXIT' ".build-logs/$1.log" 2>/dev/null; do sleep 20; done
exec scripts/run-builders.sh "$2"
