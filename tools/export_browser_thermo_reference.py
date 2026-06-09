from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = ROOT.parent
if str(PRIVATE_ROOT) not in sys.path:
    sys.path.insert(0, str(PRIVATE_ROOT))

from explain_mechanisms import explain_thermo_row  # noqa: E402


MATCH_COLUMNS = [
    "comp_C_wtpct",
    "comp_Mn_wtpct",
    "comp_Si_wtpct",
    "comp_Cr_wtpct",
    "comp_Ni_wtpct",
    "comp_Mo_wtpct",
    "comp_V_wtpct",
    "comp_Nb_wtpct",
    "comp_Ti_wtpct",
    "comp_N_wtpct",
    "comp_B_wtpct",
    "comp_Cu_wtpct",
    "comp_Al_wtpct",
    "comp_P_wtpct",
    "comp_S_wtpct",
    "comp_W_wtpct",
    "comp_known_nonbalance_sum_wtpct",
    "comp_total_wtpct",
    "comp_total_error_wtpct",
]

METRICS = [
    ("ae1_c", "tc_max_approx_ae1_c", "Ae1", "°C", 0),
    ("ae3_c", "tc_max_approx_ae3_c", "Ae3", "°C", 0),
    ("solidus_c", "tc_max_approx_solidus_c", "固相线", "°C", 0),
    ("liquidus_c", "tc_max_approx_liquidus_c", "液相线", "°C", 0),
    ("cementite_dissolution_c", "tc_max_approx_cementite_dissolution_c", "渗碳体溶解温度", "°C", 0),
    ("equilibrium_temperature_c", "tc_temperature_c", "平衡温度", "°C", 0),
    ("phase_fcc_a1", "tc_phase_fcc_a1", "FCC 相分数", "", 3),
    ("phase_bcc_a2", "tc_phase_bcc_a2", "BCC 相分数", "", 3),
    ("phase_cementite", "tc_phase_cementite_d011", "渗碳体相分数", "", 3),
    ("stable_phase_count", "tc_max_stable_phase_count", "稳定相数", "", 0),
    (
        "carbide_phase_count",
        "tc_max_stable_phase_count_carbide_or_carbonitride",
        "碳/氮化物相数",
        "",
        0,
    ),
    ("thermal_conductivity", "tc_thermal_conductivity_w_m_k", "单点热导率", "W/(m·K)", 1),
    ("scan_density_mean", "tc_max_scan_density_kg_m3_mean", "扫描平均密度", "kg/m³", 0),
    ("heat_capacity_mean", "tc_max_heat_capacity_fd_mean_j_per_mol_k", "平均热容", "J/(mol·K)", 1),
]


def main() -> None:
    modeling_path = PRIVATE_ROOT / "output" / "modeling_clean.csv"
    thermo_path = PRIVATE_ROOT / "output" / "thermo_explain.csv"
    metadata_path = PRIVATE_ROOT / "output" / "metadata.csv"
    for path in (modeling_path, thermo_path, metadata_path):
        if not path.exists():
            raise FileNotFoundError(f"Missing private source table: {path}")

    modeling = pd.read_csv(modeling_path, usecols=["material_id", "material_subclass", *MATCH_COLUMNS], low_memory=False)
    thermo = pd.read_csv(thermo_path, low_memory=False).drop_duplicates("material_id")
    metadata = pd.read_csv(
        metadata_path,
        usecols=["material_id", "material_name", "material_subclass"],
        low_memory=False,
    ).drop_duplicates("material_id")

    merged = modeling.merge(thermo, on="material_id", how="inner", suffixes=("", "_thermo"))
    merged = merged.merge(metadata, on="material_id", how="left", suffixes=("", "_meta"))

    entries: list[dict[str, Any]] = []
    for row in merged.to_dict("records"):
        explanation = explain_thermo_row(row)
        notes = [str(note) for note in explanation.get("mechanism_notes", [])[:8]]
        material_id = str(row["material_id"])
        material_name = clean_text(row.get("material_name")) or material_id
        subclass = clean_text(row.get("material_subclass_meta")) or clean_text(row.get("material_subclass")) or ""
        entries.append(
            {
                "i": material_id,
                "n": material_name,
                "s": subclass,
                "c": [round_float(row.get(col), 5) for col in MATCH_COLUMNS],
                "m": [round_float(row.get(source), digits) for _, source, _, _, digits in METRICS],
                "u": str(explanation.get("summary") or "当前热力学摘要不足以形成明确机理说明。"),
                "r": notes,
            }
        )

    payload = {
        "version": 1,
        "kind": "compact_thermo_reference",
        "description": "Derived browser demo reference. Full Thermo-Calc/source tables are not included.",
        "match_columns": MATCH_COLUMNS,
        "weights": [weight_for_column(col) for col in MATCH_COLUMNS],
        "metrics": [
            {"key": key, "label": label, "unit": unit, "digits": digits}
            for key, _, label, unit, digits in METRICS
        ],
        "entries": entries,
    }

    out_path = ROOT / "docs" / "models" / "thermo-reference.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out_path} ({len(entries)} entries)")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value).strip()


def round_float(value: Any, digits: int) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return round(parsed, digits)


def weight_for_column(col: str) -> float:
    if col == "comp_C_wtpct":
        return 3.0
    if col in {"comp_Cr_wtpct", "comp_Ni_wtpct", "comp_Mn_wtpct"}:
        return 2.0
    return 1.0


if __name__ == "__main__":
    main()
