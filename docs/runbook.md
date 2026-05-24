# Runbook

Hướng dẫn dựng project từ con số 0 + xử lý lỗi thường gặp.

## Yêu cầu hệ thống

- Windows 10/11 + WSL2 với Ubuntu (22.04+ hoặc 24.04+)
- Docker Desktop (4.x trở lên) với **WSL Integration** bật cho distro Ubuntu
- 8GB RAM free (Fabric + Flask + torch CPU)
- 10GB disk free

## Setup lần đầu

### 1. Cài Node 20 LTS qua nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
node -v   # → v20.x
```

Nếu non-interactive shell không thấy `node`:

```bash
mkdir -p ~/.local/bin
ln -sf $(which node) ~/.local/bin/node
ln -sf $(which npm)  ~/.local/bin/npm
ln -sf $(which npx)  ~/.local/bin/npx
```

(Đảm bảo `~/.local/bin` đã có trong `$PATH`.)

### 2. Cài Docker Desktop

Tải tại docker.com → cài → mở Settings → **Resources → WSL Integration** → bật Ubuntu distro.

Verify: `docker ps` chạy được trong WSL không cần sudo.

### 3. `jq` — không cần cài thủ công

`start.sh` tự kiểm tra và download `jq` vào `~/.local/bin/` nếu thiếu. Nếu muốn cài trước cũng được:

```bash
sudo apt-get install -y jq      # hoặc
curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 -o ~/.local/bin/jq && chmod +x ~/.local/bin/jq
```

### 4. Clone repo + cài Fabric

```bash
git clone <repo-url> Hoang
cd Hoang

# Tải Fabric 2.5.15 binaries + docker images + samples
./install-fabric.sh -f 2.5.15 docker samples binary
```

Nếu `install-fabric.sh` chưa có:

```bash
curl -fsSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh -f 2.5.15 docker samples binary
```

Verify:

```bash
./fabric-samples/bin/peer version    # → 2.5.15
docker images | grep hyperledger     # → ~5 image (peer, orderer, ccenv, baseos, ca)
docker pull hyperledger/fabric-nodeenv:2.5    # install-fabric không kéo cái này
```

### 5. Copy model YOLO

```bash
cp /path/to/Yolo/Hoang/runs/classify/.../weights/best.pt flask-server/model/best.pt
ls -lh flask-server/model/best.pt   # → ~25MB
```

### 6. Khởi động

```bash
./start.sh
```

Lần đầu: build 3 image (~10 phút, vì torch CPU ~500MB). Lần sau cache, ~30s.

## Kiểm chứng

```bash
# Health
curl http://localhost:3000/health   # → {"status":"ok"}
curl http://localhost:5000/health   # → {"status":"ok", "model":"/app/model/best.pt"}

# End-to-end 1 ảnh
curl -F image=@mock-client/sample-images/fresh_apple.png \
     -F lat=10.762 -F lng=106.660 \
     http://localhost:5000/api/predict-harvest | jq

# Query ledger
curl -s http://localhost:3000/records | jq '.count'

# CouchDB Fauxton: http://localhost:5984/_utils (admin/adminpw)
# Database: mychannel_harvest-cc
```

## Mock client (gửi tải)

```bash
# Vô hạn, 5s/lần
docker compose -f docker-compose.app.yml --profile mock up mock-client

# Giới hạn 20 request, 2s/lần
docker compose -f docker-compose.app.yml run --rm \
  -e COUNT=20 -e INTERVAL=2 mock-client
```

## Tắt

```bash
./stop.sh           # giữ ledger data (CouchDB volumes)
./stop.sh --purge   # xóa hết, reset sạch
```

## Troubleshooting

### `start.sh` báo "fabric-samples not found"

```bash
./install-fabric.sh -f 2.5.15 docker samples binary
```

### `start.sh` báo "model file missing"

Copy file `best.pt` vào `flask-server/model/`. Xem mục 5 ở trên.

### `network.sh deployCC` báo "ledger already exists"

Network ở trạng thái dở. Reset:

```bash
./stop.sh --purge
./start.sh
```

### `deployCC` lỗi `No such image: hyperledger/fabric-nodeenv:2.5`

```bash
docker pull hyperledger/fabric-nodeenv:2.5
./start.sh   # retry — start.sh skip step đã làm
```

### Bridge log "context deadline exceeded"

Peer chưa sẵn sàng hoặc TLS cert sai path.

```bash
docker ps | grep peer0.org1   # phải Up
docker logs peer0.org1.example.com 2>&1 | tail -20
ls fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
```

Nếu cert missing → reset network: `./stop.sh --purge && ./start.sh`.

### Flask container restart liên tục

```bash
docker logs flask-server 2>&1 | tail -30
```

Thường là OOM (ảnh quá lớn) hoặc thiếu model. Check `flask-server/model/best.pt` exists trong container:

```bash
docker exec flask-server ls -lh /app/model/
```

### Port 5000/3000/5984/7051 đã bị chiếm

```bash
ss -tlnp | grep -E ":(3000|5000|5984|7050|7051|9051)"
```

Kill process chiếm port hoặc đổi port trong `docker-compose.app.yml` + `network.sh up -i <port>` cho Fabric.

### Build image quá lâu

Lần đầu build `flask-server` ~5-10 phút vì kéo torch CPU ~500MB. Có cache rồi thì re-build code change <30s.

### `docker compose` báo network `fabric_test` not found

Test-network chưa lên. `start.sh` xử lý thứ tự đúng — chạy lại nó. Nếu vẫn lỗi:

```bash
docker network ls | grep fabric_test
cd fabric-samples/test-network && ./network.sh up createChannel -s couchdb
```

## Logs & Debugging

### Tất cả log có `trace=<uuid>` để correlate 1 request xuyên 3 layer

```bash
# Pick 1 trace từ Flask
docker logs flask-server 2>&1 | grep "trace=" | head -5

# Grep cùng trace trong bridge
TRACE="<paste-uuid>"
docker logs node-bridge 2>&1 | grep "trace=$TRACE"
```

### Inspect record trong CouchDB

```bash
curl -s -u admin:adminpw http://localhost:5984/mychannel_harvest-cc/_all_docs?include_docs=true | jq '.rows[0].doc'
```

### Inspect chaincode container

Fabric peer tự spawn container `dev-peer0.orgN.example.com-harvest-cc_1.0-<hash>` cho chaincode runtime. Log:

```bash
docker logs $(docker ps --filter "name=dev-peer0.org1.*harvest-cc" --format '{{.Names}}')
```

## Reset hoàn toàn

```bash
./stop.sh --purge
docker system prune -af --volumes
rm -rf fabric-samples
./install-fabric.sh -f 2.5.15 docker samples binary
./start.sh
```
