from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer


TARGET_COLUMNS = (
    "target_tensile_strength_mpa",
    "target_yield_strength_mpa",
    "target_elongation_pct",
)

UNSAFE_FEATURE_NAME_CHARS = re.compile(r"[^0-9A-Za-z_=.\-]+")

IDENTITY_COLUMNS = {
    "material_id",
    "material_name",
    "title",
    "source_file",
    "mat_type_raw",
    "material_class",
    "quality_tier",
    "dataset_theme",
    "family_class",
    "material_domain",
    "split",
    "split_original",
    "process_text",
    "target_fields_cleaned",
    "has_any_target_cleaned",
}

THERMO_NUMERIC_PREFIXES = (
    "tc_phase_",
    "tc_ext_",
    "tc_max_exists_",
    "tc_max_selected_phase_count",
    "tc_max_partition_",
    "tc_max_scan_",
    "tc_max_scheil_",
    "tc_max_stable_np_",
    "tc_max_stable_npm_",
    "tc_max_stable_bpw_",
    "tc_max_stable_vpv_",
)

THERMO_NUMERIC_COLUMNS = {
    "tc_temperature_c",
    "tc_component_count",
    "tc_dropped_wtpct",
    "tc_gibbs_energy_j_per_mol",
    "tc_enthalpy_j_per_mol",
    "tc_entropy_j_per_mol_k",
    "tc_molar_volume_m3_per_mol",
    "tc_thermal_conductivity_w_m_k",
    "tc_max_temperature_c",
    "tc_max_component_count",
    "tc_max_stable_phase_count",
    "tc_max_stable_phase_count_matrix",
    "tc_max_stable_phase_count_carbide_or_carbonitride",
    "tc_max_stable_phase_count_boride_or_boride_like",
    "tc_max_stable_phase_count_other",
    "tc_max_stable_phase_count_intermetallic",
    "tc_max_approx_solidus_c",
    "tc_max_approx_liquidus_c",
    "tc_max_approx_ae1_c",
    "tc_max_approx_ae3_c",
    "tc_max_approx_cementite_dissolution_c",
    "tc_max_approx_bcc_fcc_equal_fraction_c",
    "tc_max_heat_capacity_fd_mean_j_per_mol_k",
    "tc_max_thermal_expansion_fd_mean_1_per_k",
}

NON_FEATURE_SUFFIXES = ("_source_count",)
NON_NUMERIC_THERMO_TOKENS = (
    "_status",
    "_methods",
    "_note",
    "_error",
    "_phases",
    "_elements",
    "_source",
    "_database",
    "_balance_element",
    "_primary_solid_phase",
    "_last_solid_phase_set",
)


@dataclass(frozen=True)
class FeatureSpec:
    numeric_columns: list[str]
    categorical_columns: list[str]
    text_columns: list[str]


class FeaturePreprocessor:
    def __init__(self, spec: FeatureSpec):
        self.spec = spec
        self.numeric_medians_: pd.Series | None = None
        self.category_levels_: dict[str, list[str]] = {}
        self.text_vectorizers_: dict[str, TfidfVectorizer] = {}
        self.feature_names_: list[str] = []

    def fit(self, df: pd.DataFrame) -> "FeaturePreprocessor":
        numeric = self._numeric_frame(df)
        self.numeric_medians_ = numeric.median(numeric_only=True).fillna(0.0)
        self.category_levels_ = {}
        for col in self.spec.categorical_columns:
            if col in df.columns:
                levels = sorted(df[col].fillna("<MISSING>").astype(str).unique())
            else:
                levels = []
            self.category_levels_[col] = levels
        self.text_vectorizers_ = {}
        for col in self._text_columns():
            vectorizer = TfidfVectorizer(
                analyzer="word",
                lowercase=True,
                ngram_range=(1, 2),
                min_df=2,
                max_features=96,
                token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9_\-]+\b",
            )
            values = self._text_series(df, col)
            try:
                vectorizer.fit(values)
            except ValueError:
                vectorizer = TfidfVectorizer(
                    analyzer="char_wb",
                    lowercase=True,
                    ngram_range=(3, 5),
                    min_df=1,
                    max_features=32,
                )
                vectorizer.fit(values)
            self.text_vectorizers_[col] = vectorizer
        transformed = self.transform(df)
        self.feature_names_ = list(transformed.columns)
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        if self.numeric_medians_ is None:
            raise RuntimeError("FeaturePreprocessor must be fitted before transform().")

        numeric = self._numeric_frame(df)
        numeric = numeric.reindex(columns=self.spec.numeric_columns)
        numeric = numeric.fillna(self.numeric_medians_).fillna(0.0)

        frames = [numeric.astype(np.float32)]
        for col in self.spec.categorical_columns:
            levels = self.category_levels_.get(col, [])
            values = (
                df[col].fillna("<MISSING>").astype(str)
                if col in df.columns
                else pd.Series("<MISSING>", index=df.index)
            )
            if not levels:
                continue
            encoded_values = (
                values.to_numpy(dtype=object)[:, None] == np.asarray(levels, dtype=object)[None, :]
            ).astype(np.float32)
            encoded_columns = make_unique_feature_names(
                [f"{sanitize_feature_name(col)}={sanitize_feature_name(level)}" for level in levels]
            )
            frames.append(pd.DataFrame(encoded_values, columns=encoded_columns, index=df.index))

        for col in self._text_columns():
            vectorizer = self.text_vectorizers_.get(col)
            if vectorizer is None:
                continue
            values = self._text_series(df, col)
            matrix = vectorizer.transform(values)
            names = make_unique_feature_names(
                [
                    f"{sanitize_feature_name(col)}_tfidf_{sanitize_feature_name(term)}"
                    for term in vectorizer.get_feature_names_out()
                ]
            )
            frames.append(pd.DataFrame(matrix.toarray(), columns=names, index=df.index, dtype=np.float32))

        return pd.concat(frames, axis=1)

    def _numeric_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        data: dict[str, pd.Series] = {}
        for col in self.spec.numeric_columns:
            if col in df.columns:
                data[col] = pd.to_numeric(df[col], errors="coerce")
            else:
                data[col] = pd.Series(np.nan, index=df.index)
        return pd.DataFrame(data, index=df.index)

    def _text_series(self, df: pd.DataFrame, col: str) -> pd.Series:
        if col not in df.columns:
            return pd.Series("", index=df.index)
        return df[col].fillna("").astype(str)

    def _text_columns(self) -> list[str]:
        return list(getattr(self.spec, "text_columns", []))


def build_feature_spec(df: pd.DataFrame) -> FeatureSpec:
    numeric_columns: list[str] = []
    categorical_columns: list[str] = []
    text_columns: list[str] = []

    if "material_subclass" in df.columns:
        categorical_columns.append("material_subclass")
    if "process_text" in df.columns and df["process_text"].fillna("").astype(str).str.strip().ne("").any():
        text_columns.append("process_text")

    for col in df.columns:
        if not is_candidate_feature(col):
            continue
        if col in categorical_columns:
            continue
        if should_use_numeric_feature(col, df[col]):
            numeric_columns.append(col)

    return FeatureSpec(
        numeric_columns=sorted(dict.fromkeys(numeric_columns)),
        categorical_columns=categorical_columns,
        text_columns=text_columns,
    )


def is_candidate_feature(col: str) -> bool:
    if col in IDENTITY_COLUMNS:
        return False
    if col in TARGET_COLUMNS or col.startswith("target_"):
        return False
    if col.endswith(NON_FEATURE_SUFFIXES):
        return False
    if col == "clean_target_count":
        return False
    if col == "material_subclass":
        return True
    if col.startswith(("phys_", "websafe_phys_")):
        return True
    if col.startswith(("comp_", "ht_", "proc_kw_", "process_")):
        return col != "process_text"
    if col.startswith("tc_"):
        return is_numeric_thermo_feature_name(col)
    return False


def is_numeric_thermo_feature_name(col: str) -> bool:
    lower = col.lower()
    if any(token in lower for token in NON_NUMERIC_THERMO_TOKENS):
        return False
    if col in THERMO_NUMERIC_COLUMNS:
        return True
    return col.startswith(THERMO_NUMERIC_PREFIXES)


def should_use_numeric_feature(col: str, values: pd.Series) -> bool:
    numeric = pd.to_numeric(values, errors="coerce")
    return bool(numeric.notna().any())


def sanitize_feature_name(value: object) -> str:
    text = str(value).strip()
    text = UNSAFE_FEATURE_NAME_CHARS.sub("_", text)
    text = text.strip("_")
    return text or "missing"


def make_unique_feature_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique: list[str] = []
    for name in names:
        count = seen.get(name, 0)
        seen[name] = count + 1
        unique.append(name if count == 0 else f"{name}_{count}")
    return unique
