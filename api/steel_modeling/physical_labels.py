from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


TEMP_C_PATTERN = re.compile(r"([-+]?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b", re.IGNORECASE)
TEMP_F_PATTERN = re.compile(r"([-+]?\d+(?:\.\d+)?)\s*(?:°\s*)?f\b", re.IGNORECASE)
SIZE_MM_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*mm\b", re.IGNORECASE)
SIZE_IN_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:in\.?|inch|inches)\b", re.IGNORECASE)
STANDARD_PATTERN = re.compile(
    r"\b(?:ASTM|ASME|SAE|ISO|DIN|JIS|GB/T|GB|GOST|KS|BS|EN|AFNOR|UNS|IS)\b",
    re.IGNORECASE,
)


ROUTE_KEYWORDS = {
    "anneal": ("anneal", "annealed", "annealing", "spheroidize", "spheroidizing", "+a"),
    "normalize": ("normaliz", "+n"),
    "quench": ("quench", "quenched", "quenching"),
    "temper": ("temper", "tempered", "tempering", "+t", "+th"),
    "solution": ("solution", "solution treated", "solution anneal"),
    "age": ("age", "aged", "aging", "precipitation harden"),
    "cold_work": ("cold worked", "cold drawn", "cold rolled", "+c", "ann cd"),
    "hot_work": ("hot rolled", "hot forging", "hot forged", "hot worked"),
    "carburize": ("carbur",),
}

COOLING_SCORES = {
    "furnace": 0,
    "air": 1,
    "oil": 2,
    "water": 3,
    "brine": 4,
}


def extract_temperatures_c(text: Any) -> list[float]:
    raw = "" if pd.isna(text) else str(text)
    values: list[float] = []
    for match in TEMP_C_PATTERN.finditer(raw):
        values.append(round(float(match.group(1)), 3))
    for match in TEMP_F_PATTERN.finditer(raw):
        fahrenheit = float(match.group(1))
        values.append(round((fahrenheit - 32.0) * 5.0 / 9.0, 3))
    return values


def add_physical_labels(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    text = out["process_text"].fillna("").astype(str) if "process_text" in out.columns else pd.Series("", index=out.index)
    lower = text.str.lower()

    route_flags = {name: has_any_keyword(lower, keywords) for name, keywords in ROUTE_KEYWORDS.items()}
    for name, values in route_flags.items():
        out[f"phys_route_{name}"] = values.astype(np.int8)

    out["phys_route_quench_temper"] = ((route_flags["quench"] == 1) & (route_flags["temper"] == 1)).astype(np.int8)
    out["phys_route_normalize_temper"] = ((route_flags["normalize"] == 1) & (route_flags["temper"] == 1)).astype(np.int8)
    out["phys_route_solution_age"] = ((route_flags["solution"] == 1) & (route_flags["age"] == 1)).astype(np.int8)

    out["phys_cooling_severity_score"] = infer_cooling_severity(lower).astype(np.float32)
    out["phys_cooling_is_explicit"] = out["phys_cooling_severity_score"].notna().astype(np.int8)

    temp_info = text.apply(parse_temperature_info)
    out["phys_explicit_temperature_count"] = temp_info.apply(lambda x: x["count"]).astype(np.int16)
    out["phys_explicit_temperature_min_c"] = temp_info.apply(lambda x: x["min_c"]).astype(np.float32)
    out["phys_explicit_temperature_max_c"] = temp_info.apply(lambda x: x["max_c"]).astype(np.float32)
    out["phys_explicit_austenitize_temp_c"] = temp_info.apply(lambda x: x["austenitize_c"]).astype(np.float32)
    out["phys_explicit_temper_temp_c"] = temp_info.apply(lambda x: x["temper_c"]).astype(np.float32)

    out["phys_section_size_mm"] = text.apply(extract_section_size_mm).astype(np.float32)
    out["phys_section_size_known"] = out["phys_section_size_mm"].notna().astype(np.int8)

    ae1 = numeric_col(out, "tc_max_approx_ae1_c")
    ae3 = numeric_col(out, "tc_max_approx_ae3_c")
    aust = pd.to_numeric(out["phys_explicit_austenitize_temp_c"], errors="coerce")
    temper = pd.to_numeric(out["phys_explicit_temper_temp_c"], errors="coerce")
    out["phys_austenitize_above_ae3"] = tri_state(aust > ae3, aust.notna() & ae3.notna())
    out["phys_austenitize_between_ae1_ae3"] = tri_state((aust > ae1) & (aust <= ae3), aust.notna() & ae1.notna() & ae3.notna())
    out["phys_temper_below_ae1"] = tri_state(temper < ae1, temper.notna() & ae1.notna())
    out["phys_temper_high_temp"] = tri_state(temper >= 500.0, temper.notna())
    out["phys_temper_secondary_hardening_window"] = tri_state((temper >= 450.0) & (temper <= 600.0), temper.notna())

    c = numeric_col(out, "comp_C_wtpct")
    cr = numeric_col(out, "comp_Cr_wtpct")
    mn = numeric_col(out, "comp_Mn_wtpct")
    mo = numeric_col(out, "comp_Mo_wtpct")
    ni = numeric_col(out, "comp_Ni_wtpct")
    v = numeric_col(out, "comp_V_wtpct")
    nb = numeric_col(out, "comp_Nb_wtpct")
    ti = numeric_col(out, "comp_Ti_wtpct")
    b = numeric_col(out, "comp_B_wtpct")

    out["phys_carbon_strength_potential"] = c.astype(np.float32)
    out["phys_high_carbon_flag"] = (c >= 0.6).astype(np.int8)
    out["phys_low_carbon_flag"] = (c <= 0.08).astype(np.int8)
    out["phys_hardenability_index"] = (
        c * 3.0 + mn * 0.7 + cr * 0.55 + ni * 0.35 + mo * 1.0 + v * 1.3 + b * 80.0
    ).astype(np.float32)
    out["phys_carbide_former_index"] = (cr * 0.35 + mo * 1.2 + v * 2.0 + nb * 2.5 + ti * 2.0).astype(np.float32)
    out["phys_microalloy_precipitation_potential"] = ((v + nb + ti) * 10.0).astype(np.float32)
    out["phys_austenite_stabilizer_index"] = (ni + 0.5 * mn + 30.0 * c).astype(np.float32)
    out["phys_ferrite_stabilizer_index"] = (cr + 1.5 * mo + 0.5 * v).astype(np.float32)
    out["phys_martensite_potential_score"] = (
        out["phys_route_quench_temper"] * (1.0 + c.clip(0.0, 1.2) * 2.0) + (out["phys_cooling_severity_score"].fillna(0.0) / 4.0)
    ).astype(np.float32)

    has_process_text = text.str.strip().ne("")
    has_action = sum(route_flags.values()).gt(0)
    has_temp = out["phys_explicit_temperature_count"] > 0
    has_standard = lower.apply(lambda x: bool(STANDARD_PATTERN.search(x)))
    out["phys_has_standard_only_text"] = (has_standard & ~has_action & ~has_temp).astype(np.int8)
    out["phys_process_detail_missing"] = (~has_action & ~has_temp).astype(np.int8)
    out["phys_process_text_present"] = has_process_text.astype(np.int8)
    out["phys_rule_confidence_score"] = compute_rule_confidence(
        has_process_text=has_process_text,
        has_action=has_action,
        has_temp=has_temp,
        has_cooling=out["phys_cooling_is_explicit"].astype(bool),
        has_size=out["phys_section_size_known"].astype(bool),
        has_standard_only=out["phys_has_standard_only_text"].astype(bool),
    ).astype(np.float32)
    return out


def has_any_keyword(lower_text: pd.Series, keywords: tuple[str, ...]) -> pd.Series:
    result = pd.Series(False, index=lower_text.index)
    for keyword in keywords:
        result = result | lower_text.str.contains(re.escape(keyword), regex=True, na=False)
    return result


def infer_cooling_severity(lower_text: pd.Series) -> pd.Series:
    score = pd.Series(np.nan, index=lower_text.index, dtype=float)
    for keyword, value in COOLING_SCORES.items():
        score = score.mask(lower_text.str.contains(keyword, regex=False, na=False), float(value))
    return score


def parse_temperature_info(text: Any) -> dict[str, float]:
    values = extract_temperatures_c(text)
    if not values:
        return {"count": 0, "min_c": np.nan, "max_c": np.nan, "austenitize_c": np.nan, "temper_c": np.nan}
    high = [v for v in values if v >= 700.0]
    temper = [v for v in values if 100.0 <= v < 700.0]
    return {
        "count": len(values),
        "min_c": min(values),
        "max_c": max(values),
        "austenitize_c": max(high) if high else np.nan,
        "temper_c": max(temper) if temper else np.nan,
    }


def extract_section_size_mm(text: Any) -> float:
    raw = "" if pd.isna(text) else str(text)
    mm = [float(m.group(1)) for m in SIZE_MM_PATTERN.finditer(raw)]
    if mm:
        return max(mm)
    inches = [float(m.group(1)) * 25.4 for m in SIZE_IN_PATTERN.finditer(raw)]
    if inches:
        return max(inches)
    return np.nan


def numeric_col(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series(0.0, index=df.index, dtype=float)
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0)


def tri_state(condition: pd.Series, known: pd.Series) -> pd.Series:
    values = pd.Series(-1, index=condition.index, dtype=np.int8)
    values = values.mask(known & condition, 1)
    values = values.mask(known & ~condition, 0)
    return values


def compute_rule_confidence(
    has_process_text: pd.Series,
    has_action: pd.Series,
    has_temp: pd.Series,
    has_cooling: pd.Series,
    has_size: pd.Series,
    has_standard_only: pd.Series,
) -> pd.Series:
    score = pd.Series(0.0, index=has_process_text.index, dtype=float)
    score += has_process_text.astype(float) * 0.15
    score += has_action.astype(float) * 0.3
    score += has_temp.astype(float) * 0.25
    score += has_cooling.astype(float) * 0.15
    score += has_size.astype(float) * 0.1
    score -= has_standard_only.astype(float) * 0.15
    return score.clip(0.0, 1.0)


def build_physical_label_report(df: pd.DataFrame) -> dict[str, Any]:
    phys_cols = [c for c in df.columns if c.startswith("phys_")]
    report: dict[str, Any] = {
        "row_count": int(len(df)),
        "physical_label_count": len(phys_cols),
        "physical_columns": phys_cols,
        "coverage": {},
        "notes": [
            "phys_ columns are rule-derived proxy labels, not measured processing metadata.",
            "Unknown tri-state flags use -1 where the needed temperature or thermodynamic reference is missing.",
            "These labels are intended for model features, applicability checks, and explanation text.",
        ],
    }
    for col in phys_cols:
        values = df[col]
        numeric = pd.to_numeric(values, errors="coerce")
        report["coverage"][col] = {
            "nonnull_fraction": float(values.notna().mean()),
            "mean": float(numeric.mean()) if numeric.notna().any() else None,
            "positive_fraction": float((numeric == 1).mean()) if numeric.notna().any() else None,
        }
    return report


def write_physical_label_report(df: pd.DataFrame, path: Path) -> None:
    report = build_physical_label_report(df)
    lines = [
        "# Physical rule labels report",
        "",
        f"- Rows: {report['row_count']}",
        f"- Added physical proxy labels: {report['physical_label_count']}",
        "",
        "## Notes",
        "",
    ]
    lines.extend(f"- {note}" for note in report["notes"])
    lines.extend(["", "## Coverage", "", "| column | non-null | mean | positive fraction |", "|---|---:|---:|---:|"])
    for col, info in report["coverage"].items():
        lines.append(
            f"| {col} | {info['nonnull_fraction']:.3f} | {format_optional(info['mean'])} | {format_optional(info['positive_fraction'])} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def format_optional(value: float | None) -> str:
    return "" if value is None else f"{value:.3f}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report-md", type=Path)
    parser.add_argument("--report-json", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    df = pd.read_csv(args.input, low_memory=False)
    out = add_physical_labels(df)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, index=False)
    if args.report_md:
        args.report_md.parent.mkdir(parents=True, exist_ok=True)
        write_physical_label_report(out, args.report_md)
    if args.report_json:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(json.dumps(build_physical_label_report(out), ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
