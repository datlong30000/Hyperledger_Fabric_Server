# Hoang — Backend truy xuất nguồn gốc trái cây

Gửi 1 ảnh trái cây + tọa độ GPS → hệ thống tự nhận diện (táo/chuối/cam × tươi/hỏng/chưa chín) → lưu kết quả lên blockchain để sau này không ai sửa được.

## Bạn cần gì

| Thứ | Cài ở đâu |
|---|---|
| Windows 10/11 + WSL2 Ubuntu | `wsl --install` trong PowerShell admin |
| Docker Desktop (bật "WSL Integration" cho Ubuntu) | docker.com |
| ~10GB ổ cứng trống | (Fabric + Torch image to) |

Model `best.pt` đã có sẵn trong repo tại `flask-server/model/best.pt` — clone xong là dùng được.

Lần đầu setup chi tiết từ con số 0: xem [docs/runbook.md](docs/runbook.md).

## Chạy thử (1 lệnh)

**Windows:** double-click `start.bat` từ Windows Explorer.

**WSL/Linux terminal:** `./start.sh`

Script sẽ tự download Hyperledger Fabric (nếu chưa có), dựng blockchain, deploy chaincode, build và bật server. **Lần đầu mất ~15 phút** (kéo Fabric binaries + Docker images + Torch ~500MB). Các lần sau dưới 30 giây.

Khi thấy banner `=== READY ===`, mở 3 link sau để xác nhận:

| | URL | Dùng để |
|---|---|---|
| Trạng thái AI server | http://localhost:5000/health | Phải trả `{"status":"ok"}` |
| Trạng thái blockchain bridge | http://localhost:3000/health | Phải trả `{"status":"ok"}` |
| Xem dữ liệu đã lưu | http://localhost:5984/_utils | Login `admin` / `adminpw`, chọn database `mychannel_harvest-cc` |

## Gửi 1 ảnh và xem kết quả

```bash
curl -F image=@mock-client/sample-images/fresh_apple.png \
     -F lat=10.762 -F lng=106.660 \
     http://localhost:5000/api/predict-harvest
```

Trả về JSON kiểu:

```json
{
  "status": "ok",
  "id": "harvest-9a73762617dd",
  "fruitType": "freshapples",
  "confidence": 1.0,
  "imageHash": "428d413b011d33...",
  "traceId": "..."
}
```

Trong đó:
- `fruitType` — kết quả AI phân loại (1 trong 9 lớp: freshapples / freshbanana / freshoranges / rottenapples / rottenbanana / rottenoranges / unripeapples / unripebanana / unripeoranges)
- `confidence` — độ tin cậy 0.0-1.0
- `imageHash` — "dấu vân tay" SHA-256 của ảnh. Bất kỳ ai cũng tự verify được bằng `sha256sum your_image.png` rồi so với hash này. Nếu khớp → ảnh chưa bị chỉnh sửa.
- `id` — mã record trên blockchain

## Gửi data từ thiết bị khác (ESP32, app điện thoại, ...)

Chỉ có **1 địa chỉ duy nhất** cần biết:

```
POST http://<IP-máy-server>:5000/api/predict-harvest
```

Body là form-data 3 trường:

| Trường | Kiểu | Mô tả |
|---|---|---|
| `image` | file | Ảnh JPEG hoặc PNG |
| `lat`   | text | Vĩ độ (số thực, ví dụ `10.762`) |
| `lng`   | text | Kinh độ (số thực, ví dụ `106.660`) |

**Vài lưu ý:**

- Nếu thiết bị (ESP32, điện thoại) ở cùng Wi-Fi với máy server, đổi `localhost` thành IP máy server. Lấy IP bằng cách: trong PowerShell chạy `ipconfig`, lấy "IPv4 Address" của adapter Wi-Fi (ví dụ `192.168.1.50`).
- Tường lửa Windows có thể chặn port 5000 — vào Windows Defender Firewall → cho phép Docker Desktop.
- ESP32-CAM không có GPS sẵn. Hoặc hardcode tọa độ điểm thu hoạch, hoặc gắn module GPS riêng (như NEO-6M).
- Mỗi request là 1 record độc lập trên blockchain. Không cần đăng nhập/token gì.

## Xem tất cả records đã lưu

```bash
curl http://localhost:3000/records
```

Hoặc mở Fauxton ở http://localhost:5984/_utils → chọn database `mychannel_harvest-cc` → nhìn từng document.

## Dùng mock client để spam thử

Để test khi không có thiết bị thật, mock-client gửi liên tục ảnh ngẫu nhiên:

```bash
# Vô hạn, 5 giây/lần
docker compose -f docker-compose.app.yml --profile mock up mock-client

# Có giới hạn: 20 ảnh, 2 giây/lần rồi dừng
docker compose -f docker-compose.app.yml run --rm \
  -e COUNT=20 -e INTERVAL=2 mock-client
```

## Tắt

**Windows:** double-click `stop.bat`.

**WSL/Linux:** `./stop.sh`

Thêm `--purge` (hoặc `stop.bat --purge` chạy từ cmd) để xóa luôn dữ liệu blockchain → reset sạch.

## Cấu trúc thư mục

```
Hoang/
├── flask-server/         AI server (Flask + YOLO)
│   └── model/best.pt     File model (gitignored, xin riêng)
├── node-bridge/          Cầu nối từ Flask sang blockchain (Node.js)
├── chaincode/            Code chạy bên trong blockchain (Node.js)
├── mock-client/          Trình giả lập client
│   └── sample-images/    9 ảnh mẫu (1 ảnh/lớp)
├── fabric-samples/       Hyperledger Fabric (gitignored, cài qua install-fabric.sh)
├── docs/
│   ├── architecture.md   Sơ đồ + giải thích cách hoạt động
│   └── runbook.md        Setup từ 0 + xử lý lỗi
├── docker-compose.app.yml
├── start.sh / start.bat  1 lệnh khởi động
└── stop.sh  / stop.bat   1 lệnh tắt
```

## Khi gặp lỗi

2 lỗi phổ biến nhất:

1. **Lần đầu build rất lâu** → bình thường (tải Fabric + Torch ~1GB). Cứ chờ, lần sau dưới 30s.
2. **`start.sh` báo "model file missing"** → kiểm tra git clone đã hoàn tất chưa (file `flask-server/model/best.pt` phải tồn tại, ~25MB).

Đầy đủ + sâu hơn: [docs/runbook.md](docs/runbook.md).

## Muốn hiểu cách nó hoạt động?

Xem [docs/architecture.md](docs/architecture.md) — có sơ đồ tuần tự 1 ảnh đi qua các tầng.

Tóm tắt: ảnh đến Flask → Flask gọi AI phân loại + băm ảnh → gửi sang Node bridge → bridge nói chuyện với Hyperledger Fabric → record được commit và lưu vào CouchDB.

## License

Apache-2.0.
