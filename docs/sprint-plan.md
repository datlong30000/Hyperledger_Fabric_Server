# Sprint Plan — Fabric Backend Core

**Phạm vi:** Backend Core gồm Flask Server + YOLO26-cls Inference + Hyperledger Fabric Ledger + Mock Client. Không có phần cứng xe/ESP32/Dashboard.

## Stack đã chốt

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| AI Model | YOLO26-cls (`best.pt`) | Classifier 9 lớp {táo,chuối,cam}×{tươi,hỏng,chưa chín}. Hash NGUYÊN ẢNH (không bbox). |
| Middleware AI | Flask (Python 3.10+) | Ultralytics ecosystem. |
| Bridge Blockchain | Node.js 20 LTS + `@hyperledger/fabric-gateway` | Vì không có Fabric Gateway SDK Python chính thức. |
| Chaincode | Node.js (`fabric-contract-api`) | <100 dòng, 2 hàm. |
| Blockchain | Hyperledger Fabric 2.5.15 LTS | `test-network` của `fabric-samples`. |
| State DB | CouchDB | Rich query qua Mango. |
| Mock client | Python `requests` | Quét folder ảnh, POST chu kỳ. |
| Container | Docker + Docker Compose | 1 lệnh `./start.sh` cho sinh viên. |

## Data Model lưu trên ledger

```json
{
  "ID": "harvest-<uuid>",
  "Timestamp": "ISO-8601",
  "Latitude": 10.762,
  "Longitude": 106.660,
  "FruitType": "fresh_apple",       // top1 label từ classifier
  "Confidence": 0.987,              // top1conf
  "ImageHash": "<sha256 hex>"
}
```

## Sprint 0 — Foundation (1-2 ngày)

| # | Task | DoD |
|---|---|---|
| S0.1 | Cài Node 20 LTS qua nvm | `node -v` → v20.x |
| S0.2 | Skeleton + git init | Folder structure + .gitignore + README + commit baseline |
| S0.3 | Install Fabric 2.5.15 binaries + samples | `./bin/peer version` → 2.5.15 |
| S0.4 | Copy best.pt từ Yolo/Hoang | `flask-server/model/best.pt` ~25MB |
| S0.5 | Smoke test test-network | `./network.sh up createChannel -s couchdb` → 4 container Running, Fauxton UI accessible |

**Milestone M0:** CouchDB Fauxton mở được tại http://localhost:5984/_utils.

## Sprint 1 — Blockchain Core (1 tuần)

| # | Task | DoD |
|---|---|---|
| S1.1 | Chaincode `harvest-cc` Node.js | 2 hàm: `CreateHarvestRecord`, `GetAllRecords` |
| S1.2 | Deploy chaincode qua `network.sh deployCC` | `peer lifecycle chaincode querycommitted` thấy `harvest-cc` |
| S1.3 | `mock-client/mock_invoker.py` (CLI version) | Sinh JSON, gọi `peer chaincode invoke` qua subprocess |
| S1.4 | Verify CouchDB | Fauxton thấy DB `mychannel_harvest-cc`, ≥20 records |

**Milestone M1:** `python mock_invoker.py --count 20` → Fauxton thấy đủ 20 docs đúng schema.

## Sprint 2 — Node Bridge + Flask AI + Dockerize (1 tuần)

| # | Task | DoD |
|---|---|---|
| S2.1 | Node bridge: Express + `@hyperledger/fabric-gateway` | `POST /tx/harvest`, `GET /records` |
| S2.2 | Load Org1 admin identity từ test-network MSP | Bridge connect Gateway, không lỗi TLS |
| S2.3 | Flask `/api/predict-harvest` | Nhận multipart, classify, hash SHA-256, POST sang bridge |
| S2.4 | `Dockerfile` cho Flask + Node bridge | `docker build` thành công, `docker run` chạy được |
| S2.5 | `mock_http.py` (HTTP version) + Dockerfile | Gửi POST 5s/lần đến Flask |

**Milestone M2:** `curl -F image=@apple.jpg -F lat=10.762 -F lng=106.660 http://localhost:5000/api/predict-harvest` → record xuất hiện trong CouchDB với ImageHash khớp `sha256sum apple.jpg`.

## Sprint 3 — Docker Compose Master + E2E UAT + Docs (1 tuần)

| # | Task | DoD |
|---|---|---|
| S3.1 | `docker-compose.app.yml` master | Network external `fabric_test`, 3 service: flask-server, node-bridge, mock-client |
| S3.2 | `start.sh` orchestrate | network.sh up → deployCC → compose up. 1 lệnh duy nhất. |
| S3.3 | `stop.sh` cleanup | compose down → network.sh down. Sạch sẽ. |
| S3.4 | E2E UAT 5 phút | 100% transaction success, hash đúng, ≥60 records |
| S3.5 | Logging cấu trúc + error handling | trace_id xuyên 3 layer |
| S3.6 | Docs: architecture, runbook, video demo | README đầy đủ, người ngoài clone về chạy <15 phút |

**Milestone M3 (nghiệm thu cuối):** Người ngoài clone repo → đọc README → 1 lệnh `./start.sh` → chu trình hoàn chỉnh trong 15 phút.

## Tóm tắt milestone (cho thuyết minh)

| ID | Sprint | Hình thức chứng minh |
|---|---|---|
| M0 | S0 | Screenshot Fauxton UI (chưa có data) |
| M1 | S1 | 20 records ledger qua mock CLI |
| M2 | S2 | curl 1 ảnh → record với hash đúng |
| M3 | S3 | Video demo 3 phút + 1-lệnh-chạy |

## Quyết định kiến trúc quan trọng

1. **Python không có Fabric Gateway SDK chính thức** → kiến trúc bridge Node.js giữa Flask và Fabric.
2. **Model là CLASSIFIER không phải DETECTOR** → bỏ logic crop bbox, hash nguyên ảnh.
3. **Mọi service phải dockerize từ Sprint 2** → tránh refactor cuối.
4. **2 compose file tách biệt** — `test-network` của Hyperledger nguyên gốc, compose của ta join `fabric_test` external.
5. **Model COPY vào image** thay vì mount volume → sinh viên không phải tải model riêng.

## Rủi ro & buffer

| Rủi ro | Tác động | Mitigation |
|---|---|---|
| Chaincode Node lỗi npm install trong peer container | Block S1.2 | Buffer 0.5 ngày, fallback dùng chaincode Go |
| File 9P (Windows mount) chậm với Docker | Build/test lâu | Acceptable cho dev; nếu quá chậm move sang `/home/<user>/` |
| Image flask-server >2GB do torch | Pull/push lâu | Dùng `python:3.11-slim` + chỉ cài CPU torch |
| Fabric Gateway TLS/MSP setup phức tạp | Block S2.2 | Test bridge với 1 transaction đơn giản trước khi tích hợp Flask |
