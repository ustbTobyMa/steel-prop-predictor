from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


TARGET_META = {
    "target_tensile_strength_mpa": {"label": "抗拉强度", "unit": "MPa", "group": "mechanical"},
    "target_yield_strength_mpa": {"label": "屈服强度", "unit": "MPa", "group": "mechanical"},
    "target_elongation_pct": {"label": "断后伸长率", "unit": "%", "group": "mechanical"},
    "target_hardness": {"label": "硬度", "unit": "HB/HRC*", "group": "mechanical"},
    "target_reduction_of_area_pct": {"label": "断面收缩率", "unit": "%", "group": "mechanical"},
    "target_elastic_modulus_gpa": {"label": "弹性模量", "unit": "GPa", "group": "physical"},
    "target_poisson_ratio": {"label": "泊松比", "unit": "", "group": "physical"},
    "target_shear_modulus_gpa": {"label": "剪切模量", "unit": "GPa", "group": "physical"},
    "target_density_g_cm3": {"label": "密度", "unit": "g/cm³", "group": "physical", "low_confidence": True},
    "target_thermal_conductivity_w_m_k": {"label": "热导率", "unit": "W/(m·K)", "group": "physical"},
    "target_specific_heat_j_g_c": {"label": "比热容", "unit": "J/(g·°C)", "group": "physical"},
    "target_bulk_modulus_gpa": {"label": "体积模量", "unit": "GPa", "group": "physical", "low_confidence": True},
}


def main() -> None:
    out_dir = ROOT / "docs" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {"version": 1, "targets": {}}
    for model_path in sorted((ROOT / "models").glob("*/*/best_model.pkl")):
        bundle = load_bundle(model_path)
        target = bundle["target"]
        bundle_name = model_path.parents[1].name
        model = compact_model(bundle)
        model_file = f"{bundle_name}__{target}.json"
        write_json(out_dir / model_file, model)
        meta = TARGET_META[target]
        test_r2 = float(bundle["best_record"]["test"]["r2"])
        manifest["targets"][target] = {
            "file": model_file,
            "bundle": bundle_name,
            "label": meta["label"],
            "unit": meta["unit"],
            "group": meta["group"],
            "test_r2": test_r2,
            "confidence": confidence_label(test_r2, meta.get("low_confidence", False)),
            "feature_count": len(model["feature_names"]),
            "tree_count": len(model["trees"]),
        }
    write_json(out_dir / "manifest.json", manifest)


def load_bundle(model_path: Path) -> dict[str, Any]:
    with model_path.open("rb") as handle:
        return pickle.load(handle)


def compact_model(bundle: dict[str, Any]) -> dict[str, Any]:
    preprocessor = bundle["preprocessor"]
    dumped = bundle["model"].booster_.dump_model()
    vectorizers = {}
    for col, vectorizer in preprocessor.text_vectorizers_.items():
        idf_values = [float(v) for v in vectorizer.idf_]
        vectorizers[col] = {
            "vocabulary": {str(term): int(index) for term, index in vectorizer.vocabulary_.items()},
            "idf": idf_values,
            "norm": vectorizer.norm,
            "lowercase": vectorizer.lowercase,
            "ngram_range": list(vectorizer.ngram_range),
            "token_pattern": vectorizer.token_pattern,
        }
    return {
        "target": bundle["target"],
        "feature_names": dumped["feature_names"],
        "numeric_columns": list(preprocessor.spec.numeric_columns),
        "numeric_medians": {k: finite_or_none(v) for k, v in preprocessor.numeric_medians_.to_dict().items()},
        "category_levels": preprocessor.category_levels_,
        "text_vectorizers": vectorizers,
        "trees": [compact_node(tree["tree_structure"]) for tree in dumped["tree_info"]],
    }


def compact_node(node: dict[str, Any]) -> Any:
    if "leaf_value" in node:
        return float(node["leaf_value"])
    return [
        int(node["split_feature"]),
        float(node["threshold"]),
        1 if node.get("default_left", False) else 0,
        compact_node(node["left_child"]),
        compact_node(node["right_child"]),
    ]


def confidence_label(test_r2: float, low_confidence: bool = False) -> str:
    if low_confidence or test_r2 < 0.3:
        return "低"
    if test_r2 < 0.6:
        return "中"
    return "高"


def finite_or_none(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
