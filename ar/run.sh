#!/bin/bash
# Foreground bridge launcher; works from any current directory.
set -euo pipefail

AR_HOLDEM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$AR_HOLDEM_ROOT"

# Optional override affects only this process and its Codex children.
# Otherwise preserve the caller's existing proxy configuration.
if [[ -n "${AR_HOLDEM_PROXY:-}" ]]; then
    export HTTP_PROXY="$AR_HOLDEM_PROXY" HTTPS_PROXY="$AR_HOLDEM_PROXY"
    export http_proxy="$AR_HOLDEM_PROXY" https_proxy="$AR_HOLDEM_PROXY"
fi
export NO_PROXY="localhost,127.0.0.1,::1${NO_PROXY:+,$NO_PROXY}${no_proxy:+,$no_proxy}"
export no_proxy="$NO_PROXY"

# ar_server defaults to Lucas v16. Lucas requires eval7; prefer the repository
# virtualenv so the pinned project dependencies are used consistently.
# exec keeps Ctrl+C attached directly to Python's normal shutdown handler.
if [[ -n "${AR_HOLDEM_PYTHON:-}" ]]; then
    AR_PYTHON="$AR_HOLDEM_PYTHON"
elif [[ -x "$AR_HOLDEM_ROOT/.venv/bin/python" ]]; then
    AR_PYTHON="$AR_HOLDEM_ROOT/.venv/bin/python"
else
    AR_PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$AR_PYTHON" ]]; then
    echo "AR Hold’em: Python not found. Create .venv and install requirements-lucas.txt." >&2
    exit 1
fi
AR_MODE="lucas"
for ((i=1; i<=$#; i++)); do
    AR_ARG="${!i}"
    if [[ "$AR_ARG" == "--mode" && $((i+1)) -le $# ]]; then
        j=$((i+1)); AR_MODE="${!j}"
    elif [[ "$AR_ARG" == --mode=* ]]; then
        AR_MODE="${AR_ARG#--mode=}"
    fi
done
if [[ "$AR_MODE" == "lucas" ]] && ! "$AR_PYTHON" -c 'import eval7' >/dev/null 2>&1; then
    echo "AR Hold’em: eval7 is missing for $AR_PYTHON. Run .venv/bin/pip install -r requirements-lucas.txt (or set AR_HOLDEM_PYTHON)." >&2
    exit 1
fi
exec "$AR_PYTHON" -m holdem.ar_server "$@"
