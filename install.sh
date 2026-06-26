#!/usr/bin/env bash
# Install the Foka AI community-moderation skill into a Claude Code skills directory.
# Usage:
#   ./install.sh                 # -> ~/.claude/skills/community-moderation
#   ./install.sh ./.claude/skills/community-moderation   # project-local
set -euo pipefail

DEST="${1:-$HOME/.claude/skills/community-moderation}"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "Installing community-moderation skill -> $DEST"
mkdir -p "$DEST"
cp -r "$SRC/SKILL.md" "$SRC/resources" "$SRC/docs" "$SRC/templates" "$SRC/examples" "$DEST/"

echo "Done."
echo "Try: \"using community-moderation, moderate this message: 'validate your wallet here'\""
