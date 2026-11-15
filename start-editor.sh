#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is missing from PATH. Install the version in .node-version first.'
  exit 1
fi
exec node ./scripts/launch.ts "$@"
