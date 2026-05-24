"""
Flask AI server: nhận multipart ảnh + GPS, classify bằng YOLO26-cls,
hash nguyên ảnh SHA-256, POST sang Node bridge để commit lên Fabric ledger.
"""
import hashlib
import io
import logging
import os
import sys
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = Path(os.environ.get("MODEL_PATH", "model/best.pt"))
BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:3000")
BRIDGE_TIMEOUT = float(os.environ.get("BRIDGE_TIMEOUT", "30"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("flask-server")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

if not MODEL_PATH.exists():
    log.error("model file not found at %s", MODEL_PATH.resolve())
    sys.exit(1)

log.info("loading YOLO model from %s", MODEL_PATH.resolve())
model = YOLO(str(MODEL_PATH))
log.info("model loaded: task=%s names=%s", model.task, getattr(model, "names", "?"))


def classify(image_bytes: bytes) -> tuple[str, float]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    results = model.predict(source=img, verbose=False)
    probs = results[0].probs
    top1_idx = int(probs.top1)
    top1_conf = float(probs.top1conf)
    label = model.names[top1_idx]
    return label, round(top1_conf, 4)


@app.get("/health")
def health():
    return jsonify(status="ok", model=str(MODEL_PATH))


@app.post("/api/predict-harvest")
def predict_harvest():
    if "image" not in request.files:
        return jsonify(error="missing file field 'image'"), 400

    file = request.files["image"]
    image_bytes = file.read()
    if not image_bytes:
        return jsonify(error="empty image"), 400

    try:
        lat = float(request.form.get("lat", ""))
        lng = float(request.form.get("lng", ""))
    except ValueError:
        return jsonify(error="lat/lng must be numbers"), 400

    image_hash = hashlib.sha256(image_bytes).hexdigest()

    try:
        fruit_type, confidence = classify(image_bytes)
    except Exception as exc:
        log.exception("classify failed")
        return jsonify(error=f"classify failed: {exc}"), 500

    payload = {
        "latitude": lat,
        "longitude": lng,
        "fruitType": fruit_type,
        "confidence": confidence,
        "imageHash": image_hash,
    }

    try:
        bridge_res = requests.post(
            f"{BRIDGE_URL}/tx/harvest",
            json=payload,
            timeout=BRIDGE_TIMEOUT,
        )
    except requests.RequestException as exc:
        log.error("bridge unreachable: %s", exc)
        return jsonify(error=f"bridge unreachable: {exc}", classified=payload), 502

    if bridge_res.status_code >= 400:
        log.error("bridge returned %d: %s", bridge_res.status_code, bridge_res.text)
        return jsonify(
            error="bridge rejected",
            bridge_status=bridge_res.status_code,
            bridge_body=bridge_res.json() if bridge_res.headers.get("content-type", "").startswith("application/json") else bridge_res.text,
            classified=payload,
        ), 502

    bridge_data = bridge_res.json()
    record = bridge_data.get("record", {})
    return jsonify(
        status="ok",
        id=record.get("ID"),
        fruitType=fruit_type,
        confidence=confidence,
        imageHash=image_hash,
        lat=lat,
        lng=lng,
        timestamp=record.get("Timestamp"),
    ), 201


@app.get("/api/records")
def records():
    try:
        bridge_res = requests.get(f"{BRIDGE_URL}/records", timeout=BRIDGE_TIMEOUT)
        return jsonify(bridge_res.json()), bridge_res.status_code
    except requests.RequestException as exc:
        return jsonify(error=f"bridge unreachable: {exc}"), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    log.info("flask dev server on :%d (bridge=%s)", port, BRIDGE_URL)
    app.run(host="0.0.0.0", port=port, debug=False)
