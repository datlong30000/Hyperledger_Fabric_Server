#!/usr/bin/env bash
#
# Orchestrate Fabric test-network + harvest-cc chaincode + app services (node-bridge, flask-server).
# Idempotent: skip steps đã hoàn thành. Sinh viên chỉ cần chạy `./start.sh`.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NETWORK="$ROOT/fabric-samples/test-network"
COMPOSE_FILE="$ROOT/docker-compose.app.yml"
CHANNEL="${CHANNEL:-mychannel}"
CC_NAME="${CC_NAME:-harvest-cc}"
CC_PATH="$ROOT/chaincode"

if [ ! -d "$TEST_NETWORK" ]; then
    echo "[start] ERROR: fabric-samples not found at $TEST_NETWORK"
    echo "[start] run: ./install-fabric.sh -f 2.5.15 docker samples binary"
    exit 1
fi

if [ ! -f "$ROOT/flask-server/model/best.pt" ]; then
    echo "[start] ERROR: model file missing at flask-server/model/best.pt"
    exit 1
fi

cd "$TEST_NETWORK"

# --- Step 1: Fabric network ---
if docker ps --format '{{.Names}}' | grep -q '^peer0.org1.example.com$'; then
    echo "[start] (1/3) Fabric network already up — skipping"
else
    echo "[start] (1/3) bringing up Fabric test-network with CouchDB..."
    ./network.sh up createChannel -c "$CHANNEL" -s couchdb
fi

# --- Step 2: Chaincode ---
export PATH="$ROOT/fabric-samples/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051

if peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" 2>/dev/null | grep -q "Version:"; then
    echo "[start] (2/3) chaincode $CC_NAME already committed on $CHANNEL — skipping"
else
    echo "[start] (2/3) deploying chaincode $CC_NAME (Node.js)..."
    ./network.sh deployCC -ccn "$CC_NAME" -ccp "$CC_PATH" -ccl javascript -c "$CHANNEL"
fi

# --- Step 3: App services ---
cd "$ROOT"
echo "[start] (3/3) starting app services (node-bridge + flask-server)..."
docker compose -f "$COMPOSE_FILE" up -d --build node-bridge flask-server

echo ""
echo "[start] waiting for flask-server to be healthy..."
for i in $(seq 1 30); do
    status=$(docker inspect --format '{{.State.Health.Status}}' flask-server 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
        echo "[start] flask-server healthy after $((i*2))s"
        break
    fi
    sleep 2
done

echo ""
echo "[start] === READY ==="
echo "  Flask AI:     http://localhost:5000  (POST /api/predict-harvest, GET /api/records)"
echo "  Node bridge:  http://localhost:3000  (GET /records, GET /health)"
echo "  Fauxton UI:   http://localhost:5984/_utils  (admin/adminpw)"
echo ""
echo "Test:"
echo "  curl -F image=@mock-client/sample-images/fresh_apple.png -F lat=10.762 -F lng=106.660 http://localhost:5000/api/predict-harvest"
echo ""
echo "Run mock client (5s/lần, vô hạn):"
echo "  docker compose -f docker-compose.app.yml --profile mock up mock-client"
echo ""
echo "Stop:"
echo "  ./stop.sh"
