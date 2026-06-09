"""Public deployment service: models only, no dataset files."""

from __future__ import annotations

import json
import os
import pickle
import sys
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from column_specs import ACTIVE_COMPOSITION_COLUMNS

ROOT = Path(__file__).resolve().parent
MODEL_ROOT = ROOT.parent / "models"
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

BUNDLE_TARGETS = {
    "mechanical_lgbm": [
        "target_tensile_strength_mpa",
        "target_yield_strength_mpa",
        "target_elongation_pct",
        "target_hardness",
        "target_reduction_of_area_pct",
    ],
    "physical_lgbm": [
        "target_elastic_modulus_gpa",
        "target_poisson_ratio",
        "target_shear_modulus_gpa",
        "target_density_g_cm3",
        "target_thermal_conductivity_w_m_k",
        "target_specific_heat_j_g_c",
        "target_bulk_modulus_gpa",
    ],
}

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

INPUT_ELEMENTS = [
    ("C", "comp_C_wtpct"),
    ("Mn", "comp_Mn_wtpct"),
    ("Si", "comp_Si_wtpct"),
    ("Cr", "comp_Cr_wtpct"),
    ("Ni", "comp_Ni_wtpct"),
    ("Mo", "comp_Mo_wtpct"),
    ("V", "comp_V_wtpct"),
    ("Nb", "comp_Nb_wtpct"),
    ("Ti", "comp_Ti_wtpct"),
    ("N", "comp_N_wtpct"),
    ("B", "comp_B_wtpct"),
    ("Cu", "comp_Cu_wtpct"),
    ("Al", "comp_Al_wtpct"),
    ("P", "comp_P_wtpct"),
    ("S", "comp_S_wtpct"),
    ("W", "comp_W_wtpct"),
]


def import_physical_labels():
    from steel_modeling.physical_labels import add_physical_labels

    return add_physical_labels


@lru_cache(maxsize=64)
def load_target_bundle(bundle_name: str, target: str) -> dict[str, Any]:
    path = MODEL_ROOT / bundle_name / target / "best_model.pkl"
    with path.open("rb") as f:
        return pickle.load(f)


def build_feature_row(payload: dict[str, Any]) -> dict[str, Any]:
    composition = payload.get("composition") or {}
    row: dict[str, Any] = {
        "material_subclass": payload.get("material_subclass") or "alloy_steel",
        "process_text": payload.get("process_text") or "",
        "comp_balance_element": "Fe",
        "comp_balance_inferred": 1,
        "comp_invalid_nonbalance_sum_gt_100": 0,
    }
    for element, col in INPUT_ELEMENTS:
        value = composition.get(element)
        if value is None:
            value = composition.get(col, 0)
        row[col] = float(value or 0)
    known_sum = sum(float(row[col] or 0) for _, col in INPUT_ELEMENTS)
    row["comp_known_nonbalance_sum_wtpct"] = known_sum
    row["comp_Fe_wtpct"] = max(0.0, 100.0 - known_sum)
    row["comp_total_wtpct"] = 100.0
    row["comp_total_error_wtpct"] = 0.0
    for col in ACTIVE_COMPOSITION_COLUMNS:
        row.setdefault(col, 0.0)
    return row


def enrich_features(row: dict[str, Any]) -> pd.DataFrame:
    return import_physical_labels()(pd.DataFrame([row]))


def predict_all(frame: pd.DataFrame) -> dict[str, Any]:
    predictions: dict[str, Any] = {}
    for bundle_name, targets in BUNDLE_TARGETS.items():
        for target in targets:
            bundle_dir = MODEL_ROOT / bundle_name / target
            if not (bundle_dir / "best_model.pkl").exists():
                continue
            bundle = load_target_bundle(bundle_name, target)
            x = bundle["preprocessor"].transform(frame)
            value = float(bundle["model"].predict(x)[0])
            meta = TARGET_META[target]
            test_r2 = float(bundle["best_record"]["test"]["r2"])
            predictions[target] = {
                "label": meta["label"],
                "unit": meta["unit"],
                "group": meta["group"],
                "value": value,
                "test_r2": test_r2,
                "confidence": _confidence_label(test_r2, meta.get("low_confidence", False)),
            }
    return predictions


def explain_from_phys(frame: pd.DataFrame) -> dict[str, Any]:
    row = frame.iloc[0]
    notes: list[str] = []
    c = _safe(row, "comp_C_wtpct")
    cr = _safe(row, "comp_Cr_wtpct")
    ni = _safe(row, "comp_Ni_wtpct")
    mo = _safe(row, "comp_Mo_wtpct")
    si = _safe(row, "comp_Si_wtpct")

    if c is not None:
        notes.append(f"碳含量 {c:.3f} wt%，是强度与淬透性的核心驱动因素。")
    if _safe(row, "phys_hardenability_index") is not None:
        notes.append(f"淬透性指数约 {_safe(row, 'phys_hardenability_index'):.2f}，影响厚截面硬化能力。")
    if _safe(row, "phys_carbide_former_index") is not None and _safe(row, "phys_carbide_former_index") > 0.5:
        notes.append("Cr/Mo/V/Nb/Ti 等碳化物形成元素偏高，倾向提高硬度与耐磨性。")
    if _safe(row, "phys_austenite_stabilizer_index") is not None and _safe(row, "phys_austenite_stabilizer_index") > 2:
        notes.append("奥氏体稳定化元素（Ni/Mn/C）较高，可能提高奥氏体稳定性并影响强度-韧性平衡。")
    if _safe(row, "phys_microalloy_precipitation_potential") is not None and _safe(row, "phys_microalloy_precipitation_potential") > 0.2:
        notes.append("微合金化元素（V/Nb/Ti）存在，可能通过析出强化影响屈服强度。")
    if cr is not None and cr >= 12:
        notes.append("高铬含量提示不锈钢或耐蚀/抗氧化倾向，力学行为与碳钢差异较大。")
    if ni is not None and ni >= 8:
        notes.append("高镍含量通常对应奥氏体不锈钢或高韧性合金钢组织倾向。")
    if mo is not None and mo >= 0.3:
        notes.append("Mo 提高回火稳定性并抑制某些回火脆性。")
    if si is not None and si >= 0.5:
        notes.append("Si 可脱氧并影响铁素体强化，过高时可能影响冲击韧性。")
    if not str(row.get("process_text") or "").strip():
        notes.append("未提供工艺信息：当前预测更接近“代表工艺假设”下的趋势，不宜直接当作最终质保值。")
    notes.append("公开版不包含 Thermo-Calc 数据库检索，因此不提供相近材料的热力学对照。")

    return {
        "summary": " ".join(notes[:5]) if notes else "成分信息不足以生成详细机理说明。",
        "mechanism_notes": notes,
    }


def build_deepseek_messages(result: dict[str, Any]) -> list[dict[str, str]]:
    input_data = result.get("input") or {}
    composition = input_data.get("composition") or {}
    composition_text = ", ".join(
        f"{col.removeprefix('comp_').removesuffix('_wtpct')}={_format_number(value)}"
        for col, value in sorted(composition.items())
        if _as_float(value) not in (None, 0.0)
    )
    prediction_text = _prediction_summary(result.get("predictions") or {})
    mechanism = (result.get("explanation") or {}).get("composition_mechanism") or {}
    notes = mechanism.get("mechanism_notes") or []
    note_text = "\n".join(f"- {note}" for note in notes[:10])

    return [
        {
            "role": "system",
            "content": (
                "你是材料学助手。请基于给定钢材成分、工艺文本、模型预测和规则机理，"
                "生成中文解释。要求：不要编造数据库来源；明确指出模型不确定性；"
                "解释要随成分变化，避免通用模板；输出 3-5 条要点。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"钢种类型：{input_data.get('material_subclass') or 'unknown'}\n"
                f"工艺文本：{input_data.get('process_text') or '未提供'}\n"
                f"成分 wt%：{composition_text or '未提供'}\n"
                f"模型预测摘要：\n{prediction_text or '无'}\n"
                f"规则机理摘要：{mechanism.get('summary') or '无'}\n"
                f"规则机理要点：\n{note_text or '无'}\n\n"
                "请生成面向材料研发人员的解释，突出主要元素对强度、韧性、耐蚀、热物性的影响，"
                "并提醒哪些结论依赖工艺或模型置信度。"
            ),
        },
    ]


def enhance_explanation_with_deepseek(
    result: dict[str, Any],
    api_key: str | None = None,
    timeout: float = 20.0,
) -> dict[str, Any]:
    key = (api_key if api_key is not None else os.getenv("DEEPSEEK_API_KEY", "")).strip()
    if not key:
        return {"enabled": False, "status": "missing_api_key", "text": None}

    request_payload = {
        "model": DEEPSEEK_MODEL,
        "messages": build_deepseek_messages(result),
        "temperature": 0.2,
        "max_tokens": 900,
    }
    request = urllib.request.Request(
        DEEPSEEK_API_URL,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        return {"enabled": True, "status": "api_error", "text": None, "error": f"HTTP {exc.code}: {detail}"}
    except Exception as exc:
        return {"enabled": True, "status": "api_error", "text": None, "error": f"{type(exc).__name__}: {exc}"}

    text = (
        response_data.get("choices", [{}])[0]
        .get("message", {})
        .get("content")
    )
    if not text:
        return {"enabled": True, "status": "empty_response", "text": None}
    return {"enabled": True, "status": "ok", "text": text.strip(), "model": DEEPSEEK_MODEL}


def predict_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not MODEL_ROOT.exists():
        raise FileNotFoundError(f"Models not found at {MODEL_ROOT}")

    row = build_feature_row(payload)
    frame = enrich_features(row)
    predictions = predict_all(frame)
    phys_explain = explain_from_phys(frame)
    warnings: list[str] = []
    if not payload.get("process_text"):
        warnings.append("未输入热处理/工艺文本，力学性能预测不确定性较高。")
    if any(item.get("confidence") == "低" for item in predictions.values()):
        warnings.append("部分物理性质模型置信度较低（尤其密度），请谨慎解读。")

    mechanical = {k: v for k, v in predictions.items() if v["group"] == "mechanical"}
    physical = {k: v for k, v in predictions.items() if v["group"] == "physical"}
    result = {
        "ok": True,
        "input": {
            "material_subclass": row["material_subclass"],
            "composition": {col: row[col] for _, col in INPUT_ELEMENTS},
            "process_text": row.get("process_text", ""),
        },
        "predictions": {"mechanical": mechanical, "physical": physical},
        "explanation": {
            "composition_mechanism": phys_explain,
            "thermo_reference": None,
        },
        "warnings": warnings,
        "public_mode": True,
    }
    result["explanation"]["deepseek"] = enhance_explanation_with_deepseek(result)
    return result


def health_payload() -> dict[str, Any]:
    mechanical_ready = all(
        (MODEL_ROOT / "mechanical_lgbm" / target / "best_model.pkl").exists()
        for target in BUNDLE_TARGETS["mechanical_lgbm"]
    )
    physical_ready = all(
        (MODEL_ROOT / "physical_lgbm" / target / "best_model.pkl").exists()
        for target in BUNDLE_TARGETS["physical_lgbm"]
    )
    return {
        "ok": mechanical_ready and physical_ready,
        "mechanical_models": mechanical_ready,
        "physical_models": physical_ready,
        "deepseek_configured": bool(os.getenv("DEEPSEEK_API_KEY", "").strip()),
        "public_mode": True,
        "database_attached": False,
    }


def _confidence_label(test_r2: float, low_confidence: bool = False) -> str:
    if low_confidence or test_r2 < 0.3:
        return "低"
    if test_r2 < 0.6:
        return "中"
    return "高"


def _safe(row: pd.Series, key: str) -> float | None:
    try:
        value = float(row.get(key))
    except (TypeError, ValueError):
        return None
    if not np.isfinite(value):
        return None
    return value


def _as_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed):
        return None
    return parsed


def _format_number(value: Any) -> str:
    parsed = _as_float(value)
    if parsed is None:
        return str(value)
    return f"{parsed:g}"


def _prediction_summary(predictions: dict[str, Any]) -> str:
    lines: list[str] = []
    for group_name in ("mechanical", "physical"):
        group = predictions.get(group_name) or {}
        for item in group.values():
            value = item.get("value")
            label = item.get("label")
            unit = item.get("unit") or ""
            confidence = item.get("confidence")
            if label is None or value is None:
                continue
            lines.append(f"- {label}: {_format_number(value)} {unit}, 置信度 {confidence}")
    return "\n".join(lines[:12])
