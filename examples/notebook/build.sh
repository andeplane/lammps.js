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

# Build the `lammps-js` Python bindings wheel (repo-root python/) into
# pypi/, which `jupyter lite build` picks up automatically for the
# in-browser pip (piplite) — notebooks then `%pip install lammps-js`.
rm -rf pypi
python3 -m build --wheel --outdir pypi "$REPO_ROOT/python"

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

# Cross-origin isolation on static hosting (the coi-serviceworker trick,
# folded into JupyterLite's own service worker — only one SW can own the
# scope, and the contents API needs it to be JupyterLite's). GitHub Pages
# cannot send COOP/COEP headers, so the service worker adds them to every
# response it serves; app pages get a bootstrap that reloads once when the
# SW takes control, so the *document* is also served with the headers.
# SharedArrayBuffer then works and the KOKKOS multithreaded wasm loads.
python3 coi_patch.py "$OUT"
