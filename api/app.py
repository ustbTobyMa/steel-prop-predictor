from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from flask import Flask, jsonify, request
from flask_cors import CORS

from prediction_service import health_payload, predict_payload

app = Flask(__name__)
CORS(app)


@app.get("/")
def index():
    return jsonify(
        {
            "service": "steel-prop-api",
            "endpoints": ["/api/health", "/api/predict"],
            "public_mode": True,
        }
    )


@app.get("/api/health")
def health():
    return jsonify(health_payload())


@app.post("/api/predict")
def predict():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        return jsonify(predict_payload(payload))
    except Exception as exc:
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500
