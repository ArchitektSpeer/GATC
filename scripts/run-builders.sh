#!/usr/bin/env bash
# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Xu Zhonghe
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs the module builders (opencode + DeepSeek) in parallel, one log per module.
# Usage: scripts/run-builders.sh [mod-1-io mod-2-seq-engine ...]   (defaults to all six)
cd "$(dirname "$0")/.."
MODEL="${MODEL:-opencode-go/deepseek-v4.1-flash}"
MODS=("$@")
[ ${#MODS[@]} -eq 0 ] && MODS=(mod-1-io mod-2-seq-engine mod-3-cloning-primer mod-4-alignment-gel mod-5-canvas-ui mod-6-ai-copilot)
mkdir -p .build-logs
for m in "${MODS[@]}"; do
  ( opencode run --model "$MODEL" --auto --title "GATC $m" "$(cat ".prompts/$m.md")" > ".build-logs/$m.log" 2>&1
    echo "EXIT $?" >> ".build-logs/$m.log" ) &
done
wait
for m in "${MODS[@]}"; do echo "$m: $(tail -1 ".build-logs/$m.log")"; done
