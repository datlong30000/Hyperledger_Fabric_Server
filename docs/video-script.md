# Demo Video Storyboard (~3 phút)

Mục tiêu: cho người chấm nghiệm thu thấy được toàn bộ chu trình end-to-end trong 1 lần chạy.

## Chuẩn bị

- Terminal cỡ chữ to (≥ 16pt)
- Browser tab 1: http://localhost:5984/_utils (Fauxton)
- Browser tab 2: http://localhost:5000/health (sẽ refresh sau khi up)
- 1 ảnh sẵn sàng: `mock-client/sample-images/fresh_apple.png`
- Đã reset: `./stop.sh --purge`

## Cảnh 1 — Giới thiệu (0:00 – 0:20)

**On-screen**: README.md mở sẵn ở section "Kiến trúc".

**Voice-over** (15-20s):
> "Demo backend hệ thống truy xuất nguồn gốc trái cây. AI classify ảnh, blockchain lưu chứng thực. Stack: Flask + YOLO26 + Hyperledger Fabric 2.5 + Node bridge. Toàn bộ chạy bằng 1 lệnh duy nhất."

## Cảnh 2 — Khởi động (0:20 – 1:00)

**On-screen**: Terminal.

```bash
./start.sh
```

**Voice-over** (5-10s khi script chạy):
> "start.sh tự dựng Fabric test-network, deploy chaincode harvest-cc, rồi up node-bridge và flask-server. Idempotent — chạy lại không lỗi."

Đợi `[start] === READY ===`. Highlight 3 URL.

## Cảnh 3 — Health check (1:00 – 1:15)

**On-screen**: Terminal split với 2 lệnh.

```bash
curl http://localhost:3000/health
curl http://localhost:5000/health
```

Kết quả: cả 2 JSON `{"status":"ok"}`.

**Voice-over**:
> "Bridge và Flask đều sẵn sàng."

## Cảnh 4 — Curl 1 ảnh end-to-end (1:15 – 1:55)

**On-screen**: Terminal lớn.

```bash
# Tính hash trước
sha256sum mock-client/sample-images/fresh_apple.png

# Gửi ảnh
curl -s -F image=@mock-client/sample-images/fresh_apple.png \
        -F lat=10.762 -F lng=106.660 \
        http://localhost:5000/api/predict-harvest | jq
```

Highlight trong response:
- `fruitType: "freshapples"` — model classify
- `confidence: 1.0`
- `imageHash` — **so sánh khớp với sha256sum**
- `id: "harvest-..."`
- `traceId` — UUID

**Voice-over** (15s):
> "Flask classify → SHA-256 nguyên ảnh → POST sang bridge → bridge submit lên ledger. Hash trả về khớp với sha256sum local. ImageHash là chứng cứ tính nguyên vẹn — bất kỳ ai cũng verify được."

## Cảnh 5 — Trace ID xuyên 3 layer (1:55 – 2:20)

**On-screen**: Split terminal 3 panel.

```bash
# Pane 1: Flask
docker logs flask-server | grep "<paste-trace-từ-response>"

# Pane 2: Bridge
docker logs node-bridge | grep "<same-trace>"
```

Highlight cùng trace UUID xuất hiện ở cả 2 layer.

**Voice-over** (10s):
> "Mỗi request có trace ID propagate qua tất cả service. Debug 3 layer chỉ cần 1 lệnh grep."

## Cảnh 6 — Fauxton CouchDB (2:20 – 2:40)

**On-screen**: Browser http://localhost:5984/_utils → click `mychannel_harvest-cc` database.

Highlight: doc ID = `harvest-...` từ curl, fields đầy đủ: `FruitType`, `Confidence`, `ImageHash`, `Latitude`, `Longitude`, `Timestamp`.

**Voice-over** (15s):
> "Record vừa commit xuất hiện trong CouchDB state. Đây là rich-query DB của Fabric — có thể chạy Mango query để filter theo fruit type, theo confidence threshold, v.v."

## Cảnh 7 — Mock client tải liên tục (2:40 – 2:55)

**On-screen**: Terminal.

```bash
docker compose -f docker-compose.app.yml run --rm \
  -e COUNT=5 -e INTERVAL=1 mock-client
```

5 request OK liên tiếp.

```bash
curl -s http://localhost:3000/records | jq '.count'
```

Số records tăng đúng 5.

**Voice-over** (10s):
> "Mock client gửi nhiều ảnh khác nhau. Mỗi ảnh được classify riêng, hash riêng, commit riêng. 100% success."

## Cảnh 8 — Đóng (2:55 – 3:00)

**On-screen**: README mở ở "Roadmap" — show 4 sprint đã ✅.

**Voice-over** (5s):
> "1 lệnh start, 1 lệnh stop. Mọi thứ container, không phụ thuộc môi trường máy. Sinh viên clone về chạy <15 phút."

## Take notes

- Quay màn hình: OBS Studio, 1080p 30fps, mic external nếu có
- Tốc độ thao tác: bình thường, không tua nhanh
- Mỗi cảnh có vài giây hold trước khi chuyển để người xem kịp đọc
- Nếu `start.sh` lần đầu mất 10 phút (build torch), nên dùng cache (đã build sẵn 1 lần) cho video
