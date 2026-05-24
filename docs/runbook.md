# Runbook

Setup lần đầu từ máy trống + xử lý lỗi thường gặp. Dùng song song với [../README.md](../README.md) (README focus vào cách dùng hằng ngày, runbook focus vào setup + sửa lỗi).

## Yêu cầu hệ thống

- Windows 10/11 + WSL2 Ubuntu (22.04 hoặc 24.04)
- Docker Desktop 4.x trở lên
- 8 GB RAM trống (Fabric + Flask + Torch ăn ~4 GB)
- 10 GB ổ cứng trống

Không cần cài Node/Python/jq trên host — mọi service đều chạy trong container, `start.sh` tự cài `jq` nếu thiếu.

## Setup lần đầu (4 bước)

### Bước 1 — Bật WSL2 và cài Ubuntu

Trong PowerShell admin:

```powershell
wsl --install -d Ubuntu
```

Restart máy, mở Ubuntu lần đầu để tạo username/password.

### Bước 2 — Cài Docker Desktop

Tải tại docker.com → cài → mở **Settings → Resources → WSL Integration** → bật cho Ubuntu distro.

Verify (trong WSL Ubuntu):

```bash
docker ps     # không lỗi, không cần sudo
```

### Bước 3 — Clone repo + tải Fabric

```bash
git clone https://github.com/datlong30000/Hyperledger_Fabric_Server.git Hoang
cd Hoang
./install-fabric.sh -f 2.5.15 docker samples binary
```

`install-fabric.sh` tải Hyperledger Fabric 2.5.15 binaries + Docker images + `fabric-samples/`. Mất ~5 phút tùy mạng.

Nếu `install-fabric.sh` chưa có trong repo (lỗi gitignore):

```bash
curl -fsSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh -f 2.5.15 docker samples binary
```

Verify:

```bash
./fabric-samples/bin/peer version    # → 2.5.15
docker images | grep hyperledger     # → ~5 image
```

### Bước 4 — Copy file model

```bash
cp /path/to/best.pt flask-server/model/best.pt
ls -lh flask-server/model/best.pt    # → ~25MB
```

Xong setup. Từ giờ chỉ cần `./start.sh` (hoặc double-click `start.bat` trên Windows).

## Troubleshooting

### `start.sh` báo "fabric-samples not found"

Quay lại Bước 3 — chạy `./install-fabric.sh -f 2.5.15 docker samples binary`.

### `start.sh` báo "model file missing"

Quay lại Bước 4 — copy `best.pt` vào `flask-server/model/`.

### `deployCC` lỗi `No such image: hyperledger/fabric-nodeenv:2.5`

`install-fabric.sh` không kéo image này. Pull thủ công rồi chạy lại:

```bash
docker pull hyperledger/fabric-nodeenv:2.5
./start.sh    # start.sh idempotent — skip bước đã hoàn thành
```

### `network.sh deployCC` báo "ledger already exists" / network ở trạng thái dở

```bash
./stop.sh --purge
./start.sh
```

### Bridge log "context deadline exceeded"

Peer chưa sẵn sàng hoặc TLS cert sai. Check:

```bash
docker ps | grep peer0.org1                        # phải Up
docker logs peer0.org1.example.com 2>&1 | tail -20
```

Nếu peer down hoặc cert missing → reset:

```bash
./stop.sh --purge && ./start.sh
```

### Flask container restart liên tục

```bash
docker logs flask-server 2>&1 | tail -30
```

2 nguyên nhân thường gặp:
- Thiếu RAM (ảnh quá lớn) — resize ảnh trước khi gửi
- Thiếu model — check `docker exec flask-server ls -lh /app/model/`

### Port 5000 / 3000 / 5984 / 7051 đã bị chiếm

```bash
ss -tlnp | grep -E ":(3000|5000|5984|7050|7051|9051)"
```

Kill process chiếm port hoặc đổi port trong `docker-compose.app.yml` (+ `network.sh up -i <port>` cho Fabric port).

### Build image lần đầu rất lâu (>5 phút)

Bình thường — build `flask-server` kéo Torch CPU ~500 MB. Có cache rồi thì lần sau dưới 30 giây.

### `docker compose` báo network `fabric_test` not found

Test-network chưa lên. `start.sh` xử lý đúng thứ tự — chạy lại:

```bash
./start.sh
```

Nếu vẫn lỗi:

```bash
docker network ls | grep fabric_test
cd fabric-samples/test-network && ./network.sh up createChannel -s couchdb
```

## Debug 1 request xuyên 3 layer

Mỗi request có `trace=<uuid>` ở log của cả Flask và bridge:

```bash
# Pick 1 trace từ Flask
docker logs flask-server 2>&1 | grep "trace=" | head -5

# Grep cùng trace trong bridge
TRACE="<paste-uuid>"
docker logs node-bridge 2>&1 | grep "trace=$TRACE"
```

## Xem record trực tiếp trong CouchDB

```bash
curl -s -u admin:adminpw http://localhost:5984/mychannel_harvest-cc/_all_docs?include_docs=true | jq '.rows[0].doc'
```

Hoặc mở Fauxton UI http://localhost:5984/_utils.

## Inspect chaincode container

Fabric peer tự spawn container `dev-peer0.orgN.example.com-harvest-cc_1.0-<hash>` cho chaincode runtime:

```bash
docker logs $(docker ps --filter "name=dev-peer0.org1.*harvest-cc" --format '{{.Names}}')
```

## Reset hoàn toàn (mất hết data)

```bash
./stop.sh --purge
docker system prune -af --volumes
rm -rf fabric-samples
./install-fabric.sh -f 2.5.15 docker samples binary
./start.sh
```
