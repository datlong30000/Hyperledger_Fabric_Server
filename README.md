# Hoang — Fabric Backend Core

Hệ thống backend cho ứng dụng nhận diện độ tươi trái cây, lưu vết chứng thực dữ liệu bằng Hyperledger Fabric.

**Kiến trúc:**

```
Mock client (Python) ──HTTP──▶ Flask server (Python + YOLO26-cls)
                                        │
                                        ▼ HTTP (ImageHash + GPS metadata)
                              Node bridge (Express + @hyperledger/fabric-gateway)
                                        │
                                        ▼ gRPC
                              Hyperledger Fabric 2.5.15 (1 Orderer + 1 Peer + CouchDB)
```

## Yêu cầu môi trường

- WSL2 Ubuntu (hoặc Linux), Docker Desktop với WSL Integration bật
- Node.js 20 LTS
- Python 3.10+

## Khởi động nhanh (1 lệnh)

```bash
./start.sh        # Dựng Fabric network, deploy chaincode, lên Flask + Node bridge
./stop.sh         # Tắt toàn bộ
```

Sau khi `start.sh` xong, mở:
- Flask AI: http://localhost:5000
- CouchDB Fauxton: http://localhost:5984/_utils (admin/adminpw)
- Node bridge: http://localhost:3000/records

## Test thủ công

```bash
# Gửi 10 ảnh giả lập lên hệ thống
docker compose run --rm mock-client --count 10

# Query toàn bộ records từ ledger
curl http://localhost:3000/records | jq
```

## Cấu trúc thư mục

```
Hoang/
├── chaincode/        Hyperledger Fabric chaincode (Node.js)
├── node-bridge/      Bridge Express ↔ Fabric Gateway
├── flask-server/     AI inference + REST API (Python)
│   └── model/        best.pt (YOLO26-cls, tải riêng)
├── mock-client/      Script giả lập gửi dữ liệu test
├── storage/          Off-chain image storage (runtime)
├── fabric-samples/   Hyperledger sample (clone tự động khi setup)
├── docs/             Sprint plan, architecture, runbook
├── docker-compose.app.yml
├── start.sh
└── stop.sh
```

## Roadmap

| Sprint | Trạng thái | Nội dung |
|---|---|---|
| 0 | đang làm | Setup environment, skeleton, smoke test test-network |
| 1 | – | Chaincode + mock CLI invoker |
| 2 | – | Node bridge + Flask + dockerize từng service |
| 3 | – | Docker Compose master + E2E UAT + docs |
