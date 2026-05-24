# Hoang — Fabric Backend Core

Backend cho ứng dụng nhận diện độ tươi trái cây. Mỗi tấm ảnh được classify bằng YOLO26-cls, hash SHA-256, rồi lưu chứng thực (label + confidence + GPS + hash) lên Hyperledger Fabric ledger qua một bridge Node.js.

## Kiến trúc

```
┌───────────────┐   POST multipart    ┌────────────────────┐
│ Mock client   │ ──── (ảnh + GPS) ──▶│ Flask server       │
│ (Python)      │                     │ + YOLO26-cls       │
└───────────────┘                     │ + SHA-256          │
                                      └─────────┬──────────┘
                                                │ POST /tx/harvest
                                                │ (label, conf, hash, GPS)
                                                ▼
                                      ┌────────────────────┐
                                      │ Node bridge        │
                                      │ Express +          │
                                      │ fabric-gateway     │
                                      └─────────┬──────────┘
                                                │ gRPC + mTLS
                                                ▼
                                      ┌────────────────────┐
                                      │ Hyperledger Fabric │
                                      │ 2.5.15 (Org1+Org2) │
                                      │ + CouchDB state    │
                                      └────────────────────┘
```

3 service đều dockerized, dùng chung Docker network external `fabric_test` (do `test-network` của Hyperledger tạo).

## Yêu cầu môi trường

- WSL2 Ubuntu (hoặc Linux), Docker Desktop với WSL Integration bật
- Node.js 20 LTS (qua nvm)
- `jq`, `curl`
- Đã chạy `./install-fabric.sh -f 2.5.15 docker samples binary` (tạo `fabric-samples/`)
- File model `flask-server/model/best.pt` (~25MB, copy từ project YOLO sang)

Chi tiết môi trường + cách dựng từ con số 0 xem [docs/runbook.md](docs/runbook.md).

## Khởi động nhanh (1 lệnh)

```bash
./start.sh
```

Script tự làm: dựng test-network + CouchDB → deploy chaincode `harvest-cc` → build + up `node-bridge` + `flask-server`. Idempotent — chạy lại không bị lỗi nếu đã up sẵn.

Sau khi xong:

| Service        | URL                                |
| -------------- | ---------------------------------- |
| Flask AI       | http://localhost:5000              |
| Node bridge    | http://localhost:3000              |
| CouchDB Fauxton| http://localhost:5984/_utils       |

Credentials Fauxton: `admin` / `adminpw`. Database ledger: `mychannel_harvest-cc`.

## Test thủ công

```bash
# 1 ảnh đơn lẻ → xem record committed
curl -F image=@mock-client/sample-images/fresh_apple.png \
     -F lat=10.762 -F lng=106.660 \
     http://localhost:5000/api/predict-harvest | jq

# Query tất cả records
curl -s http://localhost:3000/records | jq '.count, .records[0]'

# Mock client (Docker): gửi liên tục 5s/lần, vô hạn
docker compose -f docker-compose.app.yml --profile mock up mock-client

# Mock client với giới hạn 20 request
docker compose -f docker-compose.app.yml run --rm \
  -e COUNT=20 -e INTERVAL=2 mock-client
```

## Tắt

```bash
./stop.sh           # giữ ledger data
./stop.sh --purge   # xóa luôn volume CouchDB
```

## Cấu trúc thư mục

```
Hoang/
├── chaincode/                  Chaincode Fabric (Node.js, 2 hàm CreateHarvest + GetAll)
├── node-bridge/                Express + fabric-gateway (REST ↔ gRPC bridge)
├── flask-server/               Flask + YOLO + SHA-256
│   └── model/best.pt           (gitignored — tải riêng từ project YOLO)
├── mock-client/                Mock CLI invoker (Sprint 1) + HTTP client (Sprint 2)
│   └── sample-images/          9 ảnh test (1 / class)
├── fabric-samples/             (gitignored — clone qua install-fabric.sh)
├── storage/                    Off-chain image storage (runtime, gitignored)
├── docs/
│   ├── sprint-plan.md          Plan 4 sprint + DoD + risk register
│   ├── architecture.md         Sequence diagram + data flow + decisions
│   ├── runbook.md              Setup từ 0, troubleshooting, recovery
│   └── video-script.md         Storyboard cho demo 3 phút
├── docker-compose.app.yml      Master compose (3 services)
├── start.sh                    1-lệnh orchestration
└── stop.sh                     Cleanup
```

## Trace ID

Mỗi request được gắn `X-Trace-Id` (UUID v4) ở Flask, propagate qua bridge, log đầy đủ ở cả 3 layer để correlate.

```bash
# Curl với trace cố định
curl -H "X-Trace-Id: my-test-123" -F image=@... ...

# Grep log
docker logs flask-server | grep "trace=my-test-123"
docker logs node-bridge  | grep "trace=my-test-123"
```

## Roadmap

| Sprint | Trạng thái | Nội dung                                                     |
| ------ | ---------- | ------------------------------------------------------------ |
| 0      | ✅         | Setup environment, skeleton, smoke test test-network         |
| 1      | ✅         | Chaincode `harvest-cc` + mock CLI invoker (Sprint 1 milestone M1) |
| 2      | ✅         | Node bridge + Flask + Dockerfile từng service (M2)           |
| 3      | ✅         | Docker Compose master + start.sh/stop.sh + UAT + docs (M3)   |

## Tài liệu thêm

- [Sprint plan](docs/sprint-plan.md) — DoD + risk register
- [Architecture](docs/architecture.md) — sequence + decisions
- [Runbook](docs/runbook.md) — setup từ 0 + troubleshooting
- [Demo script](docs/video-script.md) — 3-min storyboard

## License

Apache-2.0.
