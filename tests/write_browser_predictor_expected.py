from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from prediction_service import predict_payload


PAYLOAD = {
    "material_subclass": "alloy_steel",
    "process_text": "900C quench + 600C temper",
    "composition": {
        "C": 0.18,
        "Mn": 0.8,
        "Si": 0.25,
        "Cr": 1.0,
        "Ni": 1.2,
        "Mo": 0.2,
    },
}


def main() -> None:
    result = predict_payload(PAYLOAD)
    expected = {
        "predictions": {
            group: {target: item["value"] for target, item in values.items()}
            for group, values in result["predictions"].items()
        }
    }
    out_path = ROOT / "tests" / "browser_predictor_expected.json"
    out_path.write_text(json.dumps(expected, indent=2, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
