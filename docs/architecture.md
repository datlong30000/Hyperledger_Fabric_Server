# Architecture

## Mục tiêu

Chứng thực dữ liệu thu hoạch trái cây (label, độ tin cậy, GPS, hash ảnh) lên blockchain để bất kỳ stakeholder nào (người tiêu dùng, kiểm định, thương lái) cũng verify được tính nguyên vẹn của ảnh + metadata mà không cần tin một bên trung gian nào.

## Stack đầy đủ

| Lớp                  | Công nghệ                                  | Version       |
| -------------------- | ------------------------------------------ | ------------- |
| AI model             | YOLO26-cls (Ultralytics)                   | `best.pt` 25MB |
| AI middleware        | Flask + gunicorn                           | 3.x / 22.x    |
| Bridge               | Node.js + Express + `@hyperledger/fabric-gateway` | 20 LTS / ~1.7 |
| Chaincode            | Node.js + `fabric-contract-api`            | ~2.5          |
| Blockchain           | Hyperledger Fabric                         | 2.5.15 LTS    |
| State DB             | CouchDB                                    | 3.x           |
| Container runtime    | Docker Desktop (WSL2 backend)              |               |

## Data model

Mỗi record on-chain:

```json
{
  "docType":    "harvest",
  "ID":         "harvest-<12-hex>",
  "Timestamp":  "2026-05-24T11:42:55Z",
  "Latitude":   10.762,
  "Longitude":  106.660,
  "FruitType":  "freshapples",
  "Confidence": 0.987,
  "ImageHash":  "<sha256 hex>"
}
```

Serialize bằng `json-stringify-deterministic` + `sort-keys-recursive` để hash state nhất quán giữa các endorser.

## Sequence: 1 ảnh end-to-end

```
mock-client          flask-server              node-bridge          peer.org1            CouchDB
    │                     │                         │                    │                   │
    │── POST multipart ──▶│                         │                    │                   │
    │  image + lat + lng  │                         │                    │                   │
    │  X-Trace-Id: uuid   │                         │                    │                   │
    │                     │── SHA-256 nguyên ảnh ──▶│                    │                   │
    │                     │── YOLO classify ───────▶│                    │                   │
    │                     │  → fruit + confidence   │                    │                   │
    │                     │                         │                    │                   │
    │                     │── POST /tx/harvest ────▶│                    │                   │
    │                     │  (label, conf, hash,    │                    │                   │
    │                     │   lat, lng, trace)      │                    │                   │
    │                     │                         │── Endorse +  ─────▶│                   │
    │                     │                         │  Submit gRPC       │                   │
    │                     │                         │  CreateHarvestRec  │                   │
    │                     │                         │                    │── putState ──────▶│
    │                     │                         │                    │   docType=harvest │
    │                     │                         │                    │                   │
    │                     │                         │◀── Commit OK ──────│                   │
    │                     │◀── 201 + record ────────│                    │                   │
    │◀── 201 + traceId ───│                         │                    │                   │
```

## Quyết định kiến trúc

### 1. Python KHÔNG có Fabric Gateway SDK chính thức

Hyperledger chỉ release Gateway SDK cho **Go / Node / Java**. Python community có vài SDK 3rd-party nhưng đã ngừng maintain hoặc chậm tương thích Fabric 2.5. → Bắt buộc chèn một **Node.js bridge** giữa Flask và peer.

Trade-off: thêm 1 service. Lợi: dùng SDK chính chủ, ổn định lâu dài.

### 2. Model là CLASSIFIER, không phải DETECTOR

YOLO26-cls trả về top1 label + top1conf cho NGUYÊN ảnh — không có bounding box. → Hash SHA-256 trên TOÀN BỘ file ảnh (bytes raw), không crop. Đơn giản hơn detector + có thể verify lại bằng `sha256sum image.png`.

### 3. 2 compose file tách biệt

- `fabric-samples/test-network/compose/*.yaml` — của Hyperledger nguyên gốc, KHÔNG đụng.
- `docker-compose.app.yml` — của ta, các service join vào network `fabric_test` đã tạo (`networks.fabric_test.external: true`).

Lợi: muốn nâng version Fabric chỉ cần cập nhật fabric-samples, không phá compose của ta.

### 4. MSP material được mount, không enroll thủ công

Bridge cần cert + private key của `Admin@org1.example.com`. test-network sinh sẵn dưới `organizations/peerOrganizations/.../msp/`. Mount read-only vào container ở path `/fabric/org1`, bridge load qua env var `FABRIC_CRYPTO_ROOT`.

Production: nên dùng Fabric CA enroll runtime identity, không reuse admin. Hiện tại đủ cho academic demo + dev local.

### 5. Mock client KHÔNG auto-start

Trong compose, mock-client nằm trong `profiles: ["mock"]` để không bật mặc định. Sinh viên chạy `--profile mock up mock-client` khi muốn sinh tải.

Lý do: tránh container vô tình spam ledger lúc dev.

### 6. Trace ID ở header `X-Trace-Id`

- Flask sinh UUID v4 nếu client không gửi.
- Bridge đọc `req.header('X-Trace-Id')`, log mọi step.
- Mock client tự sinh trước khi POST.

Một request → 5+ log line phân tán 3 service đều có cùng trace, dễ correlate khi debug. Echo lại trong response header để client cũng có.

## Endpoint reference

### Flask (port 5000)

| Method | Path                    | Body / Form                | Trả về                                            |
| ------ | ----------------------- | -------------------------- | ------------------------------------------------- |
| GET    | `/health`               | -                          | `{status, model}`                                 |
| POST   | `/api/predict-harvest`  | multipart `image`, `lat`, `lng` | `{id, fruitType, confidence, imageHash, traceId}` |
| GET    | `/api/records`          | -                          | proxy `GetAllRecords` từ bridge                   |

### Node bridge (port 3000)

| Method | Path           | Body                             | Trả về                            |
| ------ | -------------- | -------------------------------- | --------------------------------- |
| GET    | `/health`      | -                                | `{status: "ok"}`                  |
| POST   | `/tx/harvest`  | `{latitude, longitude, fruitType, confidence, imageHash}` (+ optional `id`, `timestamp`) | `{status, record, traceId}`       |
| GET    | `/records`     | -                                | `{count, records}`                |

### Chaincode (`harvest-cc`, channel `mychannel`)

| Function              | Args                                                       | Trả về          |
| --------------------- | ---------------------------------------------------------- | --------------- |
| `CreateHarvestRecord` | id, timestamp, lat, lng, fruitType, confidence, imageHash | record JSON     |
| `ReadHarvestRecord`   | id                                                         | record JSON     |
| `GetAllRecords`       | -                                                          | array JSON      |

## Network topology

- Test-network (`./network.sh up createChannel -s couchdb`):
  - `orderer.example.com:7050`
  - `peer0.org1.example.com:7051` (CouchDB: `couchdb0:5984` host-exposed `:5984`)
  - `peer0.org2.example.com:9051` (CouchDB: `couchdb1:5984` host-exposed `:7984`)
- App services trên cùng Docker network `fabric_test`:
  - `node-bridge:3000` (host: `:3000`)
  - `flask-server:5000` (host: `:5000`)
  - `mock-client` (no port, profile-gated)

## Failure modes & recovery

| Failure                          | Triệu chứng                            | Recovery                                  |
| -------------------------------- | -------------------------------------- | ----------------------------------------- |
| Peer/orderer crash               | bridge `submit failed` deadline       | `./stop.sh && ./start.sh`                 |
| Chaincode container chết         | Lần đầu invoke chậm (re-init)         | Tự healing — Fabric restart container CC  |
| CouchDB lock                     | Network up nhưng deployCC timeout      | `./stop.sh --purge && ./start.sh`         |
| Flask OOM (ảnh quá lớn)          | 413/500 trên Flask                     | Tăng `MAX_UPLOAD_MB` hoặc resize ảnh     |
| Bridge mất TLS cert              | "deadline exceeded"                    | Check mount `/fabric/org1`, regen test-network |
