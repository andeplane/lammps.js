#!/usr/bin/env bash
# Build the JupyterLite notebook site. Usage: ./build.sh [output-dir]
# Requires `jupyter lite` on PATH (pip install -r requirements.txt) and the
# repo's dist/ to be built (npm run build, or build:dist with a cached wasm).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-dist}"
REPO_ROOT="$(cd ../.. && pwd)"

if [ ! -f "$REPO_ROOT/dist/client.js" ] || [ ! -s "$REPO_ROOT/dist/cpp/lammps.js" ]; then
  echo "error: $REPO_ROOT/dist is not built — run 'npm run build' first" >&2
  exit 1
fi

rm -rf "$OUT" .jupyterlite.doit.db
jupyter lite build --contents content --output-dir "$OUT"

# The notebooks import the client from {site}/lammps/client.js; ship the
# whole built package so its relative imports (worker, wasm module) resolve.
mkdir -p "$OUT/lammps"
cp -R "$REPO_ROOT/dist/." "$OUT/lammps/"

# Land visitors of {site}/ directly in the intro notebook. The stock root
# index.html must keep its embedded jupyter-config-data (subpages fetch and
# parse it), so inject an early redirect script instead of replacing the file.
python3 - "$OUT/index.html" <<'EOF'
import sys
path = sys.argv[1]
html = open(path).read()
redirect = '<script>window.location.replace("./lab/index.html?path=index.ipynb");</script>'
assert redirect not in html
html = html.replace("<head>", "<head>\n    " + redirect, 1)
open(path, "w").write(html)
EOF
