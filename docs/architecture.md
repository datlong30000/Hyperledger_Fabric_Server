# Cách hệ thống hoạt động

## Mục tiêu

Mỗi tấm ảnh trái cây thu hoạch được phân loại bằng AI rồi ghi kết quả (loại + độ tin cậy + GPS + dấu vân tay ảnh) lên blockchain. Bất kỳ ai (người tiêu dùng, kiểm định, thương lái) cũng có thể kiểm tra dữ liệu mà không cần tin một bên trung gian nào.

## Sơ đồ

```
Thiết bị/ESP32     Flask server          Node bridge         Hyperledger Fabric    CouchDB
(hoặc curl)        (AI + băm ảnh)        (cầu nối)           (blockchain)          (state DB)
     │                  │                     │                      │                  │
     │── POST ảnh ─────▶│                     │                      │                  │
     │  + lat + lng     │                     │                      │                  │
     │                  │  1. Băm SHA-256     │                      │                  │
     │                  │  2. AI phân loại    │                      │                  │
     │                  │                     │                      │                  │
     │                  │── gửi kết quả ─────▶│                      │                  │
     │                  │                     │── ghi blockchain ───▶│                  │
     │                  │                     │                      │── lưu state ────▶│
     │                  │                     │◀── OK ───────────────│                  │
     │                  │◀── record JSON ─────│                      │                  │
     │◀── response ─────│                     │                      │                  │
```

## Các thành phần

| Tên service | Vai trò | Công nghệ |
|---|---|---|
| `flask-server` | Nhận ảnh, gọi AI phân loại, băm SHA-256 ảnh | Flask + Ultralytics YOLO + gunicorn |
| `node-bridge` | Cầu nối từ Flask sang blockchain (vì Hyperledger không có SDK Python chính thức) | Node.js + Express + `@hyperledger/fabric-gateway` |
| Chaincode `harvest-cc` | Logic ghi/đọc record trên blockchain | Node.js + `fabric-contract-api` |
| `peer0.org1` + `peer0.org2` + `orderer` | Mạng blockchain (test-network mặc định của Hyperledger) | Hyperledger Fabric 2.5.15 |
| `couchdb0` + `couchdb1` | Lưu trạng thái (state) để query nhanh | CouchDB 3.x |
| `mock-client` | Trình giả lập gửi ảnh để test | Python + requests |

3 service ứng dụng (`flask-server`, `node-bridge`, `mock-client`) chạy trên cùng Docker network với mạng blockchain để gọi nhau bằng tên service.

## Dữ liệu lưu trên blockchain

Mỗi record:

```json
{
  "ID":         "harvest-9a73762617dd",
  "Timestamp":  "2026-05-24T12:34:51Z",
  "Latitude":   10.762,
  "Longitude":  106.660,
  "FruitType":  "freshapples",
  "Confidence": 0.987,
  "ImageHash":  "428d413b011d33..."
}
```

`ImageHash` là dấu vân tay SHA-256 của **toàn bộ file ảnh raw** — không crop, không resize trước khi băm. Vì vậy bất kỳ ai có ảnh gốc cũng tự verify được bằng `sha256sum ảnh.png`.

## Endpoint reference

### Flask server (port 5000) — endpoint cho client gọi

| Method | Path | Form / Body | Trả về |
|---|---|---|---|
| GET | `/health` | - | `{status, model}` |
| POST | `/api/predict-harvest` | multipart: `image`, `lat`, `lng` | `{id, fruitType, confidence, imageHash, traceId}` |
| GET | `/api/records` | - | Toàn bộ records trong ledger |

### Node bridge (port 3000) — Flask gọi qua mạng nội bộ Docker

| Method | Path | Body | Trả về |
|---|---|---|---|
| GET | `/health` | - | `{status: "ok"}` |
| POST | `/tx/harvest` | `{latitude, longitude, fruitType, confidence, imageHash}` | `{status, record, traceId}` |
| GET | `/records` | - | `{count, records}` |

### Chaincode `harvest-cc` — chạy trong blockchain

| Function | Args | Mô tả |
|---|---|---|
| `CreateHarvestRecord` | id, timestamp, lat, lng, fruitType, confidence, imageHash | Ghi 1 record mới |
| `ReadHarvestRecord` | id | Đọc 1 record |
| `GetAllRecords` | - | Đọc tất cả records |

## Các quyết định thiết kế chính

**1. Có Node bridge ở giữa Flask và blockchain.** Hyperledger chỉ có SDK chính thức cho Go / Node / Java — không có Python. Nên phải dùng Node làm cầu nối.

**2. AI là CLASSIFIER, không phải DETECTOR.** YOLO26-cls trả về 1 nhãn duy nhất cho cả ảnh — không có bounding box. Vì vậy băm SHA-256 trên cả file ảnh, không crop. Đơn giản và verify lại được dễ.

**3. Mock client KHÔNG tự bật.** Trong `docker-compose.app.yml`, mock-client nằm trong `profiles: ["mock"]` để khỏi spam blockchain khi đang dev. Phải gọi `--profile mock` để bật.

**4. Trace ID xuyên các layer.** Mỗi request được gắn 1 UUID ở header `X-Trace-Id`. Flask sinh nếu client không gửi. Cả Flask và bridge log đầy đủ → debug 1 request chỉ cần grep trace đó:

```bash
docker logs flask-server | grep "trace=<uuid>"
docker logs node-bridge  | grep "trace=<uuid>"
```

## Khi nào dùng port nào

| Port | Của service | Mở từ ngoài? |
|---|---|---|
| 5000 | Flask | **Có** — endpoint cho client gửi ảnh |
| 3000 | Node bridge | Có (debug) — Flask gọi qua mạng nội bộ Docker |
| 5984 | CouchDB | Có — Fauxton UI xem ledger |
| 7050 | Orderer Fabric | Nội bộ |
| 7051, 9051 | Peer Org1, Org2 | Nội bộ |

## Tham khảo thêm

- Sequence chi tiết hơn + chiến lược recovery: [runbook.md](runbook.md)
- Sprint plan + DoD (cho instructor): [sprint-plan.md](sprint-plan.md)
