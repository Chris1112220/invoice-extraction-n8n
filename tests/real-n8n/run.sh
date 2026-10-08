#!/usr/bin/env bash
# Optional: run the workflow in a REAL local n8n (CLI) with Google + Gemini mocked.
# Needs Node 24+ and n8n installed (npm i n8n). Uses a throwaway N8N_USER_FOLDER.
#   N8N_BIN=/path/to/node_modules/.bin/n8n ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
N8N_BIN=${N8N_BIN:-n8n}
export N8N_USER_FOLDER=${N8N_USER_FOLDER:-$PWD/.n8n-test} N8N_DIAGNOSTICS_ENABLED=false N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false GENERIC_TIMEZONE=America/New_York
node make-variant.js
node mock-gemini.js & MOCK=$!; trap 'kill $MOCK' EXIT; sleep 1
"$N8N_BIN" import:workflow --input=variant.json
"$N8N_BIN" execute --id=InvoiceV13RealRun --rawOutput > out.json
node analyze.js
