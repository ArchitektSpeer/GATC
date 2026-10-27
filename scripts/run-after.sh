#!/usr/bin/env bash
# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Qiu Shui
# SPDX-License-Identifier: GPL-3.0-or-later
# Starts builder $2 once the build log of builder $1 has finished (has an EXIT line).
# Usage: scripts/run-after.sh <previous-prompt> <next-prompt>
cd "$(dirname "$0")/.."
until grep -q '^EXIT' ".build-logs/$1.log" 2>/dev/null; do sleep 20; done
exec scripts/run-builders.sh "$2"
