"""
Flask AI server: nhận multipart ảnh + GPS, classify bằng YOLO26-cls,
hash nguyên ảnh SHA-256, POST sang Node bridge để commit lên Fabric ledger.
"""
import hashlib
import io
import logging
import os
import sys
import uuid
from pathlib import Path

import requests
from flask import Flask, g, jsonify, request
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = Path(os.environ.get("MODEL_PATH", "model/best.pt"))
BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:3000")
BRIDGE_TIMEOUT = float(os.environ.get("BRIDGE_TIMEOUT", "30"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))
MIN_CONFIDENCE = float(os.environ.get("MIN_CONFIDENCE", "0.7"))


class TraceFilter(logging.Filter):
    def filter(self, record):
        if not hasattr(record, "trace"):
            try:
                from flask import has_request_context, g as _g
                record.trace = _g.trace_id if has_request_context() and hasattr(_g, "trace_id") else "-"
            except RuntimeError:
                record.trace = "-"
        return True


_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)s [%(name)s] trace=%(trace)s %(message)s"
))
_handler.addFilter(TraceFilter())
_root = logging.getLogger()
_root.handlers = [_handler]
_root.setLevel(logging.INFO)
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


@app.before_request
def assign_trace_id():
    g.trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex


@app.after_request
def echo_trace_id(response):
    if hasattr(g, "trace_id"):
        response.headers["X-Trace-Id"] = g.trace_id
    return response


@app.get("/health")
def health():
    return jsonify(status="ok", model=str(MODEL_PATH))


@app.post("/api/predict-harvest")
def predict_harvest():
    if "image" not in request.files:
        log.warning("rejected: missing file field 'image'")
        return jsonify(error="missing file field 'image'", traceId=g.trace_id), 400

    file = request.files["image"]
    image_bytes = file.read()
    if not image_bytes:
        log.warning("rejected: empty image")
        return jsonify(error="empty image", traceId=g.trace_id), 400

    try:
        lat = float(request.form.get("lat", ""))
        lng = float(request.form.get("lng", ""))
    except ValueError:
        log.warning("rejected: lat/lng not numbers")
        return jsonify(error="lat/lng must be numbers", traceId=g.trace_id), 400

    image_hash = hashlib.sha256(image_bytes).hexdigest()
    log.info("received image=%s bytes=%d hash=%s gps=(%.4f,%.4f)",
             file.filename, len(image_bytes), image_hash[:12], lat, lng)

    try:
        fruit_type, confidence = classify(image_bytes)
    except Exception as exc:
        log.exception("classify failed")
        return jsonify(error=f"classify failed: {exc}", traceId=g.trace_id), 500

    log.info("classified fruit=%s conf=%.4f", fruit_type, confidence)

    if confidence < MIN_CONFIDENCE:
        log.info("rejected: low confidence %.4f < threshold %.4f", confidence, MIN_CONFIDENCE)
        return jsonify(
            status="rejected",
            reason="low_confidence",
            fruitType=fruit_type,
            confidence=confidence,
            threshold=MIN_CONFIDENCE,
            imageHash=image_hash,
            traceId=g.trace_id,
        ), 200

    record_id = f"harvest-{image_hash[:16]}"

    payload = {
        "id": record_id,
        "latitude": lat,
        "longitude": lng,
        "fruitType": fruit_type,
        "confidence": confidence,
        "imageHash": image_hash,
    }
    headers = {"X-Trace-Id": g.trace_id}

    try:
        bridge_res = requests.post(
            f"{BRIDGE_URL}/tx/harvest",
            json=payload,
            headers=headers,
            timeout=BRIDGE_TIMEOUT,
        )
    except requests.RequestException as exc:
        log.error("bridge unreachable: %s", exc)
        return jsonify(error=f"bridge unreachable: {exc}", classified=payload, traceId=g.trace_id), 502

    if bridge_res.status_code >= 400:
        bridge_text = bridge_res.text
        if "already exists" in bridge_text:
            log.info("rejected: duplicate id=%s hash=%s", record_id, image_hash[:12])
            return jsonify(
                status="duplicate",
                reason="image_already_recorded",
                id=record_id,
                fruitType=fruit_type,
                confidence=confidence,
                imageHash=image_hash,
                traceId=g.trace_id,
            ), 200
        log.error("bridge returned %d: %s", bridge_res.status_code, bridge_text)
        return jsonify(
            error="bridge rejected",
            bridge_status=bridge_res.status_code,
            bridge_body=bridge_res.json() if bridge_res.headers.get("content-type", "").startswith("application/json") else bridge_text,
            classified=payload,
            traceId=g.trace_id,
        ), 502

    bridge_data = bridge_res.json()
    record = bridge_data.get("record", {})
    log.info("committed id=%s", record.get("ID"))
    return jsonify(
        status="ok",
        id=record.get("ID"),
        fruitType=fruit_type,
        confidence=confidence,
        imageHash=image_hash,
        lat=lat,
        lng=lng,
        timestamp=record.get("Timestamp"),
        traceId=g.trace_id,
    ), 201


@app.get("/api/records")
def records():
    try:
        bridge_res = requests.get(
            f"{BRIDGE_URL}/records",
            headers={"X-Trace-Id": g.trace_id},
            timeout=BRIDGE_TIMEOUT,
        )
        return jsonify(bridge_res.json()), bridge_res.status_code
    except requests.RequestException as exc:
        return jsonify(error=f"bridge unreachable: {exc}", traceId=g.trace_id), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    log.info("flask dev server on :%d (bridge=%s)", port, BRIDGE_URL)
    app.run(host="0.0.0.0", port=port, debug=False)
