#!/usr/bin/env sh
# Check, install and open Aftertake with its recorded examples.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Aftertake needs Node.js 22 or newer. Install it from https://nodejs.org and try again."
  exit 1
fi
exec node scripts/aftertake.mjs --examples "$@"
