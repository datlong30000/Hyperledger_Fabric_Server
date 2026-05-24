"""
Sprint 1 mock invoker: gọi chaincode harvest-cc qua peer CLI subprocess.

Sinh dữ liệu giả (id, timestamp, GPS quanh HCMC, fruitType random, hash random)
và invoke CreateHarvestRecord N lần. Mục đích: verify chaincode + ledger flow
end-to-end TRƯỚC khi có Flask/Node bridge ở Sprint 2.
"""
import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FABRIC_SAMPLES = PROJECT_ROOT / "fabric-samples"
TEST_NETWORK = FABRIC_SAMPLES / "test-network"
ORG1_PATH = TEST_NETWORK / "organizations" / "peerOrganizations" / "org1.example.com"
ORDERER_PATH = TEST_NETWORK / "organizations" / "ordererOrganizations" / "example.com"
ORG2_PATH = TEST_NETWORK / "organizations" / "peerOrganizations" / "org2.example.com"

FRUIT_TYPES = [
    "fresh_apple", "rotten_apple", "unripe_apple",
    "fresh_banana", "rotten_banana", "unripe_banana",
    "fresh_orange", "rotten_orange", "unripe_orange",
]

HCMC_LAT, HCMC_LNG = 10.762, 106.660


def build_env() -> dict:
    env = os.environ.copy()
    env.update({
        "PATH": f"{FABRIC_SAMPLES / 'bin'}:{env.get('PATH', '')}",
        "FABRIC_CFG_PATH": str(FABRIC_SAMPLES / "config"),
        "CORE_PEER_TLS_ENABLED": "true",
        "CORE_PEER_LOCALMSPID": "Org1MSP",
        "CORE_PEER_TLS_ROOTCERT_FILE": str(ORG1_PATH / "peers" / "peer0.org1.example.com" / "tls" / "ca.crt"),
        "CORE_PEER_MSPCONFIGPATH": str(ORG1_PATH / "users" / "Admin@org1.example.com" / "msp"),
        "CORE_PEER_ADDRESS": "localhost:7051",
    })
    return env


def make_record() -> dict:
    record_id = f"harvest-{uuid.uuid4().hex[:12]}"
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lat = HCMC_LAT + random.uniform(-0.05, 0.05)
    lng = HCMC_LNG + random.uniform(-0.05, 0.05)
    fruit_type = random.choice(FRUIT_TYPES)
    confidence = round(random.uniform(0.80, 0.99), 4)
    image_hash = hashlib.sha256(os.urandom(64)).hexdigest()
    return {
        "ID": record_id,
        "Timestamp": timestamp,
        "Latitude": lat,
        "Longitude": lng,
        "FruitType": fruit_type,
        "Confidence": confidence,
        "ImageHash": image_hash,
    }


def invoke_create(channel: str, cc_name: str, record: dict, env: dict) -> tuple[bool, str]:
    orderer_ca = ORDERER_PATH / "tlsca" / "tlsca.example.com-cert.pem"
    org1_tls = ORG1_PATH / "peers" / "peer0.org1.example.com" / "tls" / "ca.crt"
    org2_tls = ORG2_PATH / "peers" / "peer0.org2.example.com" / "tls" / "ca.crt"

    payload = {
        "function": "CreateHarvestRecord",
        "Args": [
            record["ID"], record["Timestamp"],
            str(record["Latitude"]), str(record["Longitude"]),
            record["FruitType"], str(record["Confidence"]), record["ImageHash"],
        ],
    }

    cmd = [
        "peer", "chaincode", "invoke",
        "-o", "localhost:7050", "--ordererTLSHostnameOverride", "orderer.example.com",
        "--tls", "--cafile", str(orderer_ca),
        "-C", channel, "-n", cc_name,
        "--peerAddresses", "localhost:7051", "--tlsRootCertFiles", str(org1_tls),
        "--peerAddresses", "localhost:9051", "--tlsRootCertFiles", str(org2_tls),
        "-c", json.dumps(payload),
        "--waitForEvent",
    ]

    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=30)
    ok = result.returncode == 0 and "VALID" in result.stderr
    return ok, (result.stderr or result.stdout).strip().splitlines()[-1]


def main():
    parser = argparse.ArgumentParser(description="Mock invoker for harvest-cc chaincode")
    parser.add_argument("--count", type=int, default=10, help="Số record sinh (default 10)")
    parser.add_argument("--channel", default="mychannel")
    parser.add_argument("--cc", default="harvest-cc")
    parser.add_argument("--delay", type=float, default=1.0, help="Sleep giữa các tx (giây)")
    args = parser.parse_args()

    if not TEST_NETWORK.exists():
        sys.exit(f"[ERR] test-network không tồn tại tại {TEST_NETWORK}")

    env = build_env()
    success = 0
    failed = 0

    print(f"[mock_invoker] gửi {args.count} record lên chaincode '{args.cc}' channel '{args.channel}'")
    for i in range(1, args.count + 1):
        record = make_record()
        ok, last = invoke_create(args.channel, args.cc, record, env)
        if ok:
            success += 1
            print(f"  [{i:3}/{args.count}] OK  {record['ID']}  {record['FruitType']}  conf={record['Confidence']}")
        else:
            failed += 1
            print(f"  [{i:3}/{args.count}] FAIL {record['ID']}  -> {last}", file=sys.stderr)
        if i < args.count:
            time.sleep(args.delay)

    print(f"\n[mock_invoker] done — success={success}  failed={failed}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
