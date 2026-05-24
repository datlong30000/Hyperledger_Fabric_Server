#!/usr/bin/env bash
#
# Tear down app services + Fabric test-network.
# Mặc định: stop containers, giữ ledger data.
# --purge: down -v (xóa volume ledger + couchdb) cho clean reset.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NETWORK="$ROOT/fabric-samples/test-network"
COMPOSE_FILE="$ROOT/docker-compose.app.yml"
PURGE=0

for arg in "$@"; do
    case "$arg" in
        --purge|-p) PURGE=1 ;;
        --help|-h)
            echo "Usage: $0 [--purge]"
            echo "  --purge  Xóa luôn volume ledger/CouchDB cho clean reset"
            exit 0 ;;
    esac
done

# --- App services ---
echo "[stop] (1/2) stopping app services..."
docker compose -f "$COMPOSE_FILE" --profile mock down 2>/dev/null || true

# --- Fabric network ---
echo "[stop] (2/2) tearing down Fabric test-network..."
cd "$TEST_NETWORK"
./network.sh down

if [ "$PURGE" -eq 1 ]; then
    echo "[stop] --purge: pruning unused volumes"
    docker volume prune -f 2>/dev/null || true
fi

echo "[stop] done."
