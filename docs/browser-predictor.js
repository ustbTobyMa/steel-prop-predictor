const ELEMENT_TO_COLUMN = {
  C: "comp_C_wtpct",
  Mn: "comp_Mn_wtpct",
  Si: "comp_Si_wtpct",
  Cr: "comp_Cr_wtpct",
  Ni: "comp_Ni_wtpct",
  Mo: "comp_Mo_wtpct",
  V: "comp_V_wtpct",
  Nb: "comp_Nb_wtpct",
  Ti: "comp_Ti_wtpct",
  N: "comp_N_wtpct",
  B: "comp_B_wtpct",
  Cu: "comp_Cu_wtpct",
  Al: "comp_Al_wtpct",
  P: "comp_P_wtpct",
  S: "comp_S_wtpct",
  W: "comp_W_wtpct",
};

const ROUTE_KEYWORDS = {
  anneal: ["anneal", "annealed", "annealing", "spheroidize", "spheroidizing", "+a"],
  normalize: ["normaliz", "+n"],
  quench: ["quench", "quenched", "quenching"],
  temper: ["temper", "tempered", "tempering", "+t", "+th"],
  solution: ["solution", "solution treated", "solution anneal"],
  age: ["age", "aged", "aging", "precipitation harden"],
  cold_work: ["cold worked", "cold drawn", "cold rolled", "+c", "ann cd"],
  hot_work: ["hot rolled", "hot forging", "hot forged", "hot worked"],
  carburize: ["carbur"],
};

const COOLING_SCORES = { furnace: 0, air: 1, oil: 2, water: 3, brine: 4 };
const TEMP_C_RE = /([-+]?\d+(?:\.\d+)?)\s*(?:deg\s*)?(?:°\s*)?c\b/gi;
const TEMP_F_RE = /([-+]?\d+(?:\.\d+)?)\s*(?:deg\s*)?(?:°\s*)?f\b/gi;
const SIZE_MM_RE = /(\d+(?:\.\d+)?)\s*mm\b/gi;
const SIZE_IN_RE = /(\d+(?:\.\d+)?)\s*(?:in\.?|inch|inches)\b/gi;
const STANDARD_RE = /\b(?:ASTM|ASME|SAE|ISO|DIN|JIS|GB\/T|GB|GOST|KS|BS|EN|AFNOR|UNS|IS)\b/i;
const TOKEN_RE = /\b[a-zA-Z][a-zA-Z0-9_-]+\b/g;

let browserModelCache = null;

export async function predictInBrowser(payload, basePath = "./models/") {
  const assets = await loadBrowserModels(basePath);
  const row = enrichFeatures(buildFeatureRow(payload));
  const predictions = {};
  for (const [target, meta] of Object.entries(assets.manifest.targets)) {
    const model = assets.models[target];
    const features = vectorizeRow(row, model);
    predictions[target] = {
      label: meta.label,
      unit: meta.unit,
      group: meta.group,
      value: predictModel(model, features),
      test_r2: meta.test_r2,
      confidence: meta.confidence,
    };
  }
  const mechanical = Object.fromEntries(Object.entries(predictions).filter(([, item]) => item.group === "mechanical"));
  const physical = Object.fromEntries(Object.entries(predictions).filter(([, item]) => item.group === "physical"));
  return {
    ok: true,
    predictions: { mechanical, physical },
    explanation: {
      composition_mechanism: explainFromRow(row),
      thermo_reference: null,
      deepseek: { enabled: false, status: "browser_only", text: null },
    },
    warnings: browserWarnings(payload, predictions),
    public_mode: true,
    browser_mode: true,
  };
}

export async function loadBrowserModels(basePath = "./models/") {
  if (browserModelCache) return browserModelCache;
  const manifest = await fetchJson(`${basePath}manifest.json`);
  const models = {};
  for (const [target, meta] of Object.entries(manifest.targets)) {
    models[target] = await fetchJson(`${basePath}${meta.file}`);
  }
  browserModelCache = { manifest, models };
  return browserModelCache;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法加载 ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export function buildFeatureRow(payload) {
  const composition = payload.composition || {};
  const row = {
    material_subclass: payload.material_subclass || "alloy_steel",
    process_text: payload.process_text || "",
    comp_balance_element: "Fe",
    comp_balance_inferred: 1,
    comp_invalid_nonbalance_sum_gt_100: 0,
  };
  for (const [element, col] of Object.entries(ELEMENT_TO_COLUMN)) {
    row[col] = numberOrZero(composition[element] ?? composition[col]);
  }
  const knownSum = Object.values(ELEMENT_TO_COLUMN).reduce((sum, col) => sum + numberOrZero(row[col]), 0);
  row.comp_known_nonbalance_sum_wtpct = knownSum;
  row.comp_Fe_wtpct = Math.max(0, 100 - knownSum);
  row.comp_total_wtpct = 100;
  row.comp_total_error_wtpct = 0;
  return row;
}

export function enrichFeatures(row) {
  const out = { ...row };
  const text = String(out.process_text || "");
  const lower = text.toLowerCase();
  const route = {};
  for (const [name, keywords] of Object.entries(ROUTE_KEYWORDS)) {
    route[name] = keywords.some((keyword) => lower.includes(keyword)) ? 1 : 0;
    out[`phys_route_${name}`] = route[name];
  }
  out.phys_route_quench_temper = route.quench === 1 && route.temper === 1 ? 1 : 0;
  out.phys_route_normalize_temper = route.normalize === 1 && route.temper === 1 ? 1 : 0;
  out.phys_route_solution_age = route.solution === 1 && route.age === 1 ? 1 : 0;

  out.phys_cooling_severity_score = inferCoolingSeverity(lower);
  out.phys_cooling_is_explicit = Number.isFinite(out.phys_cooling_severity_score) ? 1 : 0;

  const temps = parseTemperatureInfo(text);
  out.phys_explicit_temperature_count = temps.count;
  out.phys_explicit_temperature_min_c = temps.min_c;
  out.phys_explicit_temperature_max_c = temps.max_c;
  out.phys_explicit_austenitize_temp_c = temps.austenitize_c;
  out.phys_explicit_temper_temp_c = temps.temper_c;

  out.phys_section_size_mm = extractSectionSizeMm(text);
  out.phys_section_size_known = Number.isFinite(out.phys_section_size_mm) ? 1 : 0;

  const ae1 = numberOrZero(out.tc_max_approx_ae1_c);
  const ae3 = numberOrZero(out.tc_max_approx_ae3_c);
  const aust = out.phys_explicit_austenitize_temp_c;
  const temper = out.phys_explicit_temper_temp_c;
  out.phys_austenitize_above_ae3 = triState(aust > ae3, Number.isFinite(aust) && Number.isFinite(ae3));
  out.phys_austenitize_between_ae1_ae3 = triState(aust > ae1 && aust <= ae3, Number.isFinite(aust) && Number.isFinite(ae1) && Number.isFinite(ae3));
  out.phys_temper_below_ae1 = triState(temper < ae1, Number.isFinite(temper) && Number.isFinite(ae1));
  out.phys_temper_high_temp = triState(temper >= 500, Number.isFinite(temper));
  out.phys_temper_secondary_hardening_window = triState(temper >= 450 && temper <= 600, Number.isFinite(temper));

  const c = numberOrZero(out.comp_C_wtpct);
  const cr = numberOrZero(out.comp_Cr_wtpct);
  const mn = numberOrZero(out.comp_Mn_wtpct);
  const mo = numberOrZero(out.comp_Mo_wtpct);
  const ni = numberOrZero(out.comp_Ni_wtpct);
  const v = numberOrZero(out.comp_V_wtpct);
  const nb = numberOrZero(out.comp_Nb_wtpct);
  const ti = numberOrZero(out.comp_Ti_wtpct);
  const b = numberOrZero(out.comp_B_wtpct);
  out.phys_carbon_strength_potential = c;
  out.phys_high_carbon_flag = c >= 0.6 ? 1 : 0;
  out.phys_low_carbon_flag = c <= 0.08 ? 1 : 0;
  out.phys_hardenability_index = c * 3 + mn * 0.7 + cr * 0.55 + ni * 0.35 + mo * 1 + v * 1.3 + b * 80;
  out.phys_carbide_former_index = cr * 0.35 + mo * 1.2 + v * 2 + nb * 2.5 + ti * 2;
  out.phys_microalloy_precipitation_potential = (v + nb + ti) * 10;
  out.phys_austenite_stabilizer_index = ni + 0.5 * mn + 30 * c;
  out.phys_ferrite_stabilizer_index = cr + 1.5 * mo + 0.5 * v;
  out.phys_martensite_potential_score = out.phys_route_quench_temper * (1 + Math.min(Math.max(c, 0), 1.2) * 2) + (numberOrZero(out.phys_cooling_severity_score) / 4);

  const hasProcessText = text.trim() !== "";
  const hasAction = Object.values(route).some(Boolean);
  const hasTemp = out.phys_explicit_temperature_count > 0;
  const hasStandard = STANDARD_RE.test(text);
  out.phys_has_standard_only_text = hasStandard && !hasAction && !hasTemp ? 1 : 0;
  out.phys_process_detail_missing = !hasAction && !hasTemp ? 1 : 0;
  out.phys_process_text_present = hasProcessText ? 1 : 0;
  out.phys_rule_confidence_score = ruleConfidence(hasProcessText, hasAction, hasTemp, out.phys_cooling_is_explicit === 1, out.phys_section_size_known === 1, out.phys_has_standard_only_text === 1);
  return out;
}

export function vectorizeRow(row, model) {
  const values = [];
  for (const col of model.numeric_columns) {
    const value = asNumber(row[col]);
    values.push(Number.isFinite(value) ? value : numberOrZero(model.numeric_medians[col]));
  }
  for (const [col, levels] of Object.entries(model.category_levels || {})) {
    const value = String(row[col] ?? "<MISSING>");
    for (const level of levels) {
      values.push(value === level ? 1 : 0);
    }
  }
  for (const [col, vectorizer] of Object.entries(model.text_vectorizers || {})) {
    values.push(...tfidf(String(row[col] || ""), vectorizer));
  }
  return values;
}

export function predictModel(model, features) {
  let sum = 0;
  for (const tree of model.trees) {
    sum += predictTree(tree, features);
  }
  return sum;
}

function predictTree(node, features) {
  let cursor = node;
  while (Array.isArray(cursor)) {
    const [featureIndex, threshold, defaultLeft, left, right] = cursor;
    const value = features[featureIndex];
    if (!Number.isFinite(value)) {
      cursor = defaultLeft ? left : right;
    } else {
      cursor = value <= threshold ? left : right;
    }
  }
  return cursor;
}

function tfidf(text, vectorizer) {
  const vocabulary = vectorizer.vocabulary || {};
  const counts = new Array(vectorizer.idf.length).fill(0);
  const tokens = tokenize(vectorizer.lowercase ? text.toLowerCase() : text);
  const [minN, maxN] = vectorizer.ngram_range || [1, 1];
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i <= tokens.length - n; i += 1) {
      const term = tokens.slice(i, i + n).join(" ");
      const idx = vocabulary[term];
      if (idx !== undefined) counts[idx] += 1;
    }
  }
  const weighted = counts.map((count, idx) => count * vectorizer.idf[idx]);
  if (vectorizer.norm === "l2") {
    const norm = Math.sqrt(weighted.reduce((sum, value) => sum + value * value, 0));
    if (norm > 0) return weighted.map((value) => value / norm);
  }
  return weighted;
}

function tokenize(text) {
  return Array.from(text.matchAll(TOKEN_RE), (match) => match[0]);
}

function inferCoolingSeverity(lower) {
  let score = NaN;
  for (const [keyword, value] of Object.entries(COOLING_SCORES)) {
    if (lower.includes(keyword)) score = value;
  }
  return score;
}

function parseTemperatureInfo(text) {
  const values = extractTemperaturesC(text);
  if (!values.length) return { count: 0, min_c: NaN, max_c: NaN, austenitize_c: NaN, temper_c: NaN };
  const high = values.filter((value) => value >= 700);
  const temper = values.filter((value) => value >= 100 && value < 700);
  return {
    count: values.length,
    min_c: Math.min(...values),
    max_c: Math.max(...values),
    austenitize_c: high.length ? Math.max(...high) : NaN,
    temper_c: temper.length ? Math.max(...temper) : NaN,
  };
}

function extractTemperaturesC(text) {
  const values = [];
  for (const match of text.matchAll(TEMP_C_RE)) values.push(round3(Number(match[1])));
  for (const match of text.matchAll(TEMP_F_RE)) values.push(round3((Number(match[1]) - 32) * 5 / 9));
  return values;
}

function extractSectionSizeMm(text) {
  const mm = Array.from(text.matchAll(SIZE_MM_RE), (match) => Number(match[1]));
  if (mm.length) return Math.max(...mm);
  const inches = Array.from(text.matchAll(SIZE_IN_RE), (match) => Number(match[1]) * 25.4);
  return inches.length ? Math.max(...inches) : NaN;
}

function triState(condition, known) {
  if (!known) return -1;
  return condition ? 1 : 0;
}

function ruleConfidence(hasProcessText, hasAction, hasTemp, hasCooling, hasSize, hasStandardOnly) {
  let score = 0;
  if (hasProcessText) score += 0.15;
  if (hasAction) score += 0.3;
  if (hasTemp) score += 0.25;
  if (hasCooling) score += 0.15;
  if (hasSize) score += 0.1;
  if (hasStandardOnly) score -= 0.15;
  return Math.min(1, Math.max(0, score));
}

function explainFromRow(row) {
  const notes = [];
  const c = asNumber(row.comp_C_wtpct);
  const cr = asNumber(row.comp_Cr_wtpct);
  const ni = asNumber(row.comp_Ni_wtpct);
  const mo = asNumber(row.comp_Mo_wtpct);
  const si = asNumber(row.comp_Si_wtpct);
  if (Number.isFinite(c)) notes.push(`碳含量 ${c.toFixed(3)} wt%，是强度与淬透性的核心驱动因素。`);
  if (Number.isFinite(row.phys_hardenability_index)) notes.push(`淬透性指数约 ${row.phys_hardenability_index.toFixed(2)}，影响厚截面硬化能力。`);
  if (row.phys_carbide_former_index > 0.5) notes.push("Cr/Mo/V/Nb/Ti 等碳化物形成元素偏高，倾向提高硬度与耐磨性。");
  if (row.phys_austenite_stabilizer_index > 2) notes.push("奥氏体稳定化元素（Ni/Mn/C）较高，可能提高奥氏体稳定性并影响强度-韧性平衡。");
  if (row.phys_microalloy_precipitation_potential > 0.2) notes.push("微合金化元素（V/Nb/Ti）存在，可能通过析出强化影响屈服强度。");
  if (cr >= 12) notes.push("高铬含量提示不锈钢或耐蚀/抗氧化倾向，力学行为与碳钢差异较大。");
  if (ni >= 8) notes.push("高镍含量通常对应奥氏体不锈钢或高韧性合金钢组织倾向。");
  if (mo >= 0.3) notes.push("Mo 提高回火稳定性并抑制某些回火脆性。");
  if (si >= 0.5) notes.push("Si 可脱氧并影响铁素体强化，过高时可能影响冲击韧性。");
  if (!String(row.process_text || "").trim()) notes.push("未提供工艺信息：当前预测更接近“代表工艺假设”下的趋势，不宜直接当作最终质保值。");
  notes.push("浏览器版不包含 Thermo-Calc 数据库检索，因此不提供相近材料的热力学对照。");
  return {
    summary: notes.slice(0, 5).join(" ") || "成分信息不足以生成详细机理说明。",
    mechanism_notes: notes,
  };
}

function browserWarnings(payload, predictions) {
  const warnings = ["当前为浏览器本地模型预测，模型文件会下载到访问者浏览器。"];
  if (!payload.process_text) warnings.push("未输入热处理/工艺文本，力学性能预测不确定性较高。");
  if (Object.values(predictions).some((item) => item.confidence === "低")) warnings.push("部分物理性质模型置信度较低（尤其密度），请谨慎解读。");
  return warnings;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

function numberOrZero(value) {
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
