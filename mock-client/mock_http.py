"""
Sprint 2 mock HTTP client: quét folder ảnh, POST chu kỳ đến Flask /api/predict-harvest.
"""
import argparse
import os
import random
import sys
import time
import uuid
from pathlib import Path

import requests

DEFAULT_IMAGES_DIR = Path(__file__).resolve().parent / "sample-images"
DEFAULT_URL = "http://localhost:5000/api/predict-harvest"

HCMC_LAT, HCMC_LNG = 10.762, 106.660


def discover_images(folder: Path) -> list[Path]:
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in exts and p.is_file())


def post_one(url: str, image_path: Path, timeout: float) -> tuple[bool, str, str]:
    trace_id = uuid.uuid4().hex
    lat = HCMC_LAT + random.uniform(-0.05, 0.05)
    lng = HCMC_LNG + random.uniform(-0.05, 0.05)
    with image_path.open("rb") as f:
        files = {"image": (image_path.name, f, "application/octet-stream")}
        data = {"lat": f"{lat:.6f}", "lng": f"{lng:.6f}"}
        headers = {"X-Trace-Id": trace_id}
        try:
            res = requests.post(url, files=files, data=data, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            return False, trace_id, f"request failed: {exc}"

    if res.status_code >= 400:
        return False, trace_id, f"HTTP {res.status_code}: {res.text[:200]}"

    body = res.json()
    return True, trace_id, f"id={body.get('id')} fruit={body.get('fruitType')} conf={body.get('confidence')}"


def main():
    parser = argparse.ArgumentParser(description="Mock HTTP client for Flask /api/predict-harvest")
    parser.add_argument("--url", default=os.environ.get("FLASK_URL", DEFAULT_URL))
    parser.add_argument("--images", default=os.environ.get("IMAGES_DIR", str(DEFAULT_IMAGES_DIR)))
    parser.add_argument("--interval", type=float, default=float(os.environ.get("INTERVAL", "5")))
    parser.add_argument("--count", type=int, default=int(os.environ.get("COUNT", "0")),
                        help="Số request gửi (0 = chạy vô hạn)")
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("TIMEOUT", "30")))
    args = parser.parse_args()

    folder = Path(args.images)
    if not folder.is_dir():
        sys.exit(f"[mock_http] folder không tồn tại: {folder}")

    images = discover_images(folder)
    if not images:
        sys.exit(f"[mock_http] không có ảnh trong {folder}")

    print(f"[mock_http] url={args.url}  images={len(images)}  interval={args.interval}s  count={args.count or 'inf'}")

    sent = 0
    success = 0
    failed = 0
    try:
        while args.count == 0 or sent < args.count:
            image = random.choice(images)
            ok, trace, msg = post_one(args.url, image, args.timeout)
            sent += 1
            if ok:
                success += 1
                print(f"  [{sent}] OK   trace={trace[:8]} {image.name}  {msg}")
            else:
                failed += 1
                print(f"  [{sent}] FAIL trace={trace[:8]} {image.name}  {msg}", file=sys.stderr)
            if args.count == 0 or sent < args.count:
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[mock_http] interrupted")

    print(f"\n[mock_http] done — sent={sent}  success={success}  failed={failed}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
