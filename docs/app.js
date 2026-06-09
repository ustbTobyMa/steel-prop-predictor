import { predictInBrowser } from "./browser-predictor.js";

const API_BASE = ((window.STEEL_PROP_CONFIG && window.STEEL_PROP_CONFIG.API_BASE) || "").trim();
const DEEPSEEK_SESSION_KEY = "steelprop_deepseek_demo_key";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
let volatileDeepSeekDemoKey = "";

const ELEMENTS = [
  ["C", "碳"],
  ["Mn", "锰"],
  ["Si", "硅"],
  ["Cr", "铬"],
  ["Ni", "镍"],
  ["Mo", "钼"],
  ["V", "钒"],
  ["Nb", "铌"],
  ["Ti", "钛"],
  ["N", "氮"],
  ["B", "硼"],
  ["Cu", "铜"],
  ["Al", "铝"],
  ["P", "磷"],
  ["S", "硫"],
  ["W", "钨"],
];

const PRESET_LOW_ALLOY = {
  C: 0.18,
  Mn: 0.8,
  Si: 0.25,
  Cr: 1.0,
  Ni: 1.2,
  Mo: 0.2,
};

const MECHANICAL_LABELS = ["抗拉强度", "屈服强度", "断后伸长率", "硬度", "断面收缩率"];
const PHYSICAL_LABELS = ["弹性模量", "泊松比", "剪切模量", "密度", "热导率", "比热容", "体积模量"];

const grid = document.getElementById("composition-grid");
const statusBox = document.getElementById("status-box");
const predictBtn = document.getElementById("predict-btn");
const presetBtn = document.getElementById("preset-low-alloy");
const deepseekKeyInput = document.getElementById("deepseek-key");
const saveDeepseekKeyBtn = document.getElementById("save-deepseek-key");
const clearDeepseekKeyBtn = document.getElementById("clear-deepseek-key");
const deepseekKeyStatus = document.getElementById("deepseek-key-status");

function apiUrl(path) {
  if (!API_BASE || API_BASE.includes("YOUR-RENDER-APP") || API_BASE.includes("YOUR-API")) {
    return null;
  }
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

for (const [symbol, label] of ELEMENTS) {
  const wrap = document.createElement("div");
  wrap.className = "element-field";
  wrap.innerHTML = `
    <label><span>${label} (${symbol})</span><span>wt%</span></label>
    <input type="number" min="0" max="100" step="0.001" data-element="${symbol}" value="0" />
  `;
  grid.appendChild(wrap);
}

function readComposition() {
  const composition = {};
  for (const input of grid.querySelectorAll("input[data-element]")) {
    composition[input.dataset.element] = Number(input.value || 0);
  }
  return composition;
}

function fillComposition(values) {
  for (const input of grid.querySelectorAll("input[data-element]")) {
    const key = input.dataset.element;
    input.value = values[key] ?? 0;
  }
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "—";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const text = Number(value).toFixed(digits);
  return unit ? `${text} ${unit}` : text;
}

function confidenceClass(level) {
  if (level === "高") return "conf-high";
  if (level === "中") return "conf-mid";
  return "conf-low";
}

function renderMetrics(container, metrics) {
  container.innerHTML = "";
  const entries = Object.values(metrics || {});
  if (!entries.length) {
    container.innerHTML = `<p class="placeholder">暂无结果</p>`;
    return;
  }
  for (const item of entries) {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.innerHTML = `
      <div class="label">${item.label}</div>
      <div class="value">${formatValue(item.value, item.unit)}</div>
      <div class="meta">模型 Test R² ${item.test_r2.toFixed(2)} · 置信度 <span class="${confidenceClass(item.confidence)}">${item.confidence}</span></div>
    `;
    container.appendChild(card);
  }
}

function renderApiRequired(container, labels) {
  container.innerHTML = labels.map((label) => `
    <article class="metric-card static-only">
      <div class="label">${label}</div>
      <div class="value">需要模型 API</div>
      <div class="meta">GitHub Pages 不能直接运行 Python / LightGBM 模型</div>
    </article>
  `).join("");
}

function renderExplanation(payload) {
  const compBox = document.getElementById("composition-explain");
  const thermoBox = document.getElementById("thermo-explain");
  const aiBox = document.getElementById("ai-explain");
  const comp = payload.explanation?.composition_mechanism;
  const thermo = payload.explanation?.thermo_reference;
  const ai = payload.explanation?.deepseek;
  compBox.classList.remove("placeholder");
  compBox.innerHTML = `
    <p>${comp?.summary || "暂无说明"}</p>
    ${comp?.mechanism_notes?.length ? `<ul>${comp.mechanism_notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
  `;
  if (thermo) {
    const ref = thermo.reference_material || {};
    thermoBox.classList.remove("hidden");
    thermoBox.innerHTML = `
      <strong>热力学参考（相近材料）</strong>
      <p>${escapeHtml(thermo.note || "")}</p>
      <p>参考材料：${escapeHtml(ref.material_name || ref.material_id || "—")}（${escapeHtml(ref.material_subclass || "未知子类")}）</p>
      ${renderThermoMetrics(thermo.thermo_metrics)}
      <p>${escapeHtml(thermo.summary || "")}</p>
      ${thermo.mechanism_notes?.length ? `<ul>${thermo.mechanism_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
    `;
  } else {
    thermoBox.classList.add("hidden");
    thermoBox.innerHTML = "";
  }
  if (ai?.status === "ok" && ai.text) {
    aiBox.classList.remove("hidden");
    aiBox.innerHTML = `<strong>AI 辅助解释</strong>${paragraphs(ai.text)}`;
  } else if (ai?.status === "loading") {
    aiBox.classList.remove("hidden");
    aiBox.innerHTML = `<strong>AI 辅助解释</strong><p>正在生成解释…</p>`;
  } else if (ai?.enabled && ai.status !== "ok") {
    aiBox.classList.remove("hidden");
    aiBox.innerHTML = `<strong>AI 辅助解释暂不可用</strong><p>${escapeHtml(ai.error || ai.status)}</p>`;
  } else {
    aiBox.classList.add("hidden");
    aiBox.innerHTML = "";
  }
}

function renderThermoMetrics(metrics) {
  const entries = (metrics || []).filter((item) => Number.isFinite(Number(item.value)));
  if (!entries.length) return "";
  return `
    <div class="thermo-metrics">
      ${entries.map((item) => `
        <span class="thermo-chip">
          <strong>${escapeHtml(item.label)}</strong>
          ${escapeHtml(formatThermoValue(item.value, item.unit, item.digits))}
        </span>
      `).join("")}
    </div>
  `;
}

function formatThermoValue(value, unit, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  const fixed = parsed.toFixed(Math.max(0, Number(digits) || 0));
  return unit ? `${fixed} ${unit}` : fixed;
}

function paragraphs(text) {
  return String(text)
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderWarnings(warnings) {
  const box = document.getElementById("warnings");
  if (!warnings?.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = warnings.map((w) => `<div>• ${w}</div>`).join("");
}

function getDeepSeekDemoKey() {
  try {
    return sessionStorage.getItem(DEEPSEEK_SESSION_KEY) || volatileDeepSeekDemoKey;
  } catch {
    return volatileDeepSeekDemoKey;
  }
}

function setDeepSeekKeyStatus() {
  if (getDeepSeekDemoKey()) {
    deepseekKeyStatus.textContent = "DeepSeek 辅助解释已启用：key 仅保存在当前浏览器会话";
    deepseekKeyInput.placeholder = "本次会话已保存 key；如需更换请重新粘贴";
  } else {
    deepseekKeyStatus.textContent = "未启用 DeepSeek 辅助解释";
    deepseekKeyInput.placeholder = "粘贴后点保存；不会写入 GitHub";
  }
}

function saveDeepSeekDemoKey() {
  const key = deepseekKeyInput.value.trim();
  if (!key) {
    deepseekKeyStatus.textContent = "请输入 DeepSeek API key";
    return;
  }
  volatileDeepSeekDemoKey = key;
  try {
    sessionStorage.setItem(DEEPSEEK_SESSION_KEY, key);
  } catch {
    // Some embedded preview browsers disable sessionStorage; keep the key in memory.
  }
  deepseekKeyInput.value = "";
  setDeepSeekKeyStatus();
}

function clearDeepSeekDemoKey() {
  volatileDeepSeekDemoKey = "";
  try {
    sessionStorage.removeItem(DEEPSEEK_SESSION_KEY);
  } catch {
    // Ignore unavailable sessionStorage.
  }
  deepseekKeyInput.value = "";
  setDeepSeekKeyStatus();
}

async function addDirectDeepSeekExplanation(data, payload) {
  const key = getDeepSeekDemoKey();
  if (!key) return data;
  const enhanced = {
    ...data,
    explanation: {
      ...data.explanation,
      deepseek: { enabled: true, status: "loading", text: null },
    },
  };
  renderExplanation(enhanced);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: buildDeepSeekMessages(data, payload),
        temperature: 0.2,
        max_tokens: 900,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    }
    const text = result.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("DeepSeek 返回为空");
    }
    enhanced.explanation.deepseek = {
      enabled: true,
      status: "ok",
      text,
      model: DEEPSEEK_MODEL,
    };
  } catch (err) {
    enhanced.explanation.deepseek = {
      enabled: true,
      status: "api_error",
      text: null,
      error: `${err.message}。如果浏览器提示 Failed to fetch，通常是 DeepSeek 未开放浏览器 CORS，需要后端代理。`,
    };
  }
  return enhanced;
}

function buildDeepSeekMessages(data, payload) {
  const composition = payload.composition || {};
  const compositionText = Object.entries(composition)
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([element, value]) => `${element}=${formatCompactNumber(value)}`)
    .join(", ");
  const predictionText = Object.values(data.predictions || {})
    .flatMap((group) => Object.values(group || {}))
    .map((item) => `- ${item.label}: ${formatValue(item.value, item.unit)}, 置信度 ${item.confidence}, Test R² ${item.test_r2.toFixed(2)}`)
    .join("\n");
  const mechanism = data.explanation?.composition_mechanism || {};
  const thermo = data.explanation?.thermo_reference;
  const notes = (mechanism.mechanism_notes || []).slice(0, 10).map((note) => `- ${note}`).join("\n");
  const thermoNotes = (thermo?.mechanism_notes || []).slice(0, 8).map((note) => `- ${note}`).join("\n");
  const thermoMetrics = (thermo?.thermo_metrics || [])
    .slice(0, 12)
    .map((item) => `- ${item.label}: ${formatThermoValue(item.value, item.unit, item.digits)}`)
    .join("\n");
  return [
    {
      role: "system",
      content: "你是材料学助手。基于钢材成分、工艺、模型预测和规则机理生成中文解释。不要编造数据库来源；说明模型不确定性；解释要随成分变化；输出 3-5 条要点。",
    },
    {
      role: "user",
      content: [
        `钢种类型：${payload.material_subclass || "unknown"}`,
        `工艺文本：${payload.process_text || "未提供"}`,
        `成分 wt%：${compositionText || "未提供"}`,
        `模型预测摘要：\n${predictionText || "无"}`,
        `规则机理摘要：${mechanism.summary || "无"}`,
        `规则机理要点：\n${notes || "无"}`,
        `热力学参考材料：${thermo?.reference_material?.material_name || "无"}`,
        `热力学指标：\n${thermoMetrics || "无"}`,
        `热力学摘要：${thermo?.summary || "无"}`,
        `热力学要点：\n${thermoNotes || "无"}`,
        "请生成面向材料研发人员的解释，突出主要元素对强度、韧性、耐蚀、热物性的影响，并提醒哪些结论依赖工艺或模型置信度。",
      ].join("\n"),
    },
  ];
}

function formatCompactNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed}` : `${value}`;
}

function staticMechanism(composition, processText) {
  const value = (key) => Number(composition[key] || 0);
  const knownSum = ELEMENTS.reduce((sum, [symbol]) => sum + value(symbol), 0);
  const fe = Math.max(0, 100 - knownSum);
  const notes = [
    `非 Fe 元素合计约 ${knownSum.toFixed(3)} wt%，按余额估算 Fe 约 ${fe.toFixed(3)} wt%。`,
  ];
  const c = value("C");
  const cr = value("Cr");
  const ni = value("Ni");
  const mo = value("Mo");
  const si = value("Si");
  const vnbti = value("V") + value("Nb") + value("Ti");

  if (knownSum > 100) {
    notes.push("当前成分总和超过 100 wt%，请检查输入值。");
  }
  if (c > 0) {
    notes.push(`碳含量 ${c.toFixed(3)} wt%，通常是强度、硬度和淬透性的核心影响因素。`);
  }
  if (cr + mo + value("V") + value("Nb") + value("Ti") > 1.0) {
    notes.push("Cr/Mo/V/Nb/Ti 等碳化物形成元素较明显，可能提高硬度、耐磨性和回火稳定性。");
  }
  if (ni + value("Mn") + c > 2.0) {
    notes.push("Ni/Mn/C 等奥氏体稳定化贡献较高，可能影响强韧性平衡和组织稳定性。");
  }
  if (vnbti > 0.05) {
    notes.push("V/Nb/Ti 微合金化元素存在，可能通过析出强化和晶粒细化影响屈服强度。");
  }
  if (cr >= 12) {
    notes.push("Cr 含量达到不锈钢/耐蚀钢常见区间，模型解释应与碳钢、低合金钢区分。");
  }
  if (ni >= 8) {
    notes.push("Ni 含量较高，可能对应奥氏体不锈钢或高韧性合金体系。");
  }
  if (mo >= 0.3) {
    notes.push("Mo 可提高回火稳定性，并对高温强度和耐蚀行为有贡献。");
  }
  if (si >= 0.5) {
    notes.push("Si 会带来铁素体固溶强化，含量较高时需关注韧性和加工性影响。");
  }
  if (!processText) {
    notes.push("未提供工艺/热处理信息；实际力学性能对工艺敏感，不能只凭成分定量判断。");
  }
  notes.push("当前为无 API 静态网页，以上为规则化机理说明，不是机器学习模型数值预测。");

  return {
    summary: notes.slice(0, 5).join(" "),
    mechanism_notes: notes,
  };
}

function currentPayload() {
  return {
    material_subclass: document.getElementById("material-subclass").value,
    process_text: document.getElementById("process-text").value.trim(),
    composition: readComposition(),
  };
}

function renderStaticOnly(payload, extraWarning) {
  renderApiRequired(document.getElementById("mechanical-results"), MECHANICAL_LABELS);
  renderApiRequired(document.getElementById("physical-results"), PHYSICAL_LABELS);
  renderExplanation({
    explanation: {
      composition_mechanism: staticMechanism(payload.composition, payload.process_text),
    },
  });
  renderWarnings([
    extraWarning,
    "当前 GitHub Pages 未连接后端 API，因此不显示机器学习数值预测。",
    "如需完整预测，请在本机运行 Python 服务，或以后接入可用的 API 地址。",
  ].filter(Boolean));
}

async function checkHealth() {
  const url = apiUrl("/api/health");
  if (!url) {
    statusBox.className = "status neutral";
    statusBox.textContent = "浏览器模型模式：首次预测会下载约 46 MB 静态包";
    predictBtn.textContent = "开始预测";
    return;
  }
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      statusBox.className = "status ok";
      statusBox.textContent = data.deepseek_configured
        ? "API 已连接：模型 + DeepSeek 辅助解释"
        : "API 已连接：模型预测（未配置 DeepSeek）";
    } else {
      statusBox.className = "status bad";
      statusBox.textContent = "API 未就绪，请检查 Render 部署";
    }
  } catch (err) {
    statusBox.className = "status bad";
    statusBox.textContent = `无法连接 API：${err.message}`;
  }
}

async function predict() {
  const payload = currentPayload();
  const url = apiUrl("/api/predict");
  if (!url) {
    predictBtn.disabled = true;
    predictBtn.textContent = "加载模型…";
    statusBox.className = "status neutral";
    statusBox.textContent = "正在加载浏览器模型，首次可能需要几十秒";
    try {
      const data = await predictInBrowser(payload);
      renderMetrics(document.getElementById("mechanical-results"), data.predictions.mechanical);
      renderMetrics(document.getElementById("physical-results"), data.predictions.physical);
      renderExplanation(data);
      renderWarnings(data.warnings);
      statusBox.className = "status ok";
      statusBox.textContent = "浏览器模型已就绪：本地预测完成";
      if (getDeepSeekDemoKey()) {
        statusBox.textContent = "浏览器模型已就绪：正在生成 DeepSeek 解释";
        const enhanced = await addDirectDeepSeekExplanation(data, payload);
        renderExplanation(enhanced);
        statusBox.textContent = enhanced.explanation.deepseek.status === "ok"
          ? "浏览器模型 + DeepSeek 解释完成"
          : "浏览器模型完成，DeepSeek 解释未完成";
      }
    } catch (err) {
      renderStaticOnly(payload, `浏览器模型加载失败：${err.message}`);
      statusBox.className = "status bad";
      statusBox.textContent = "浏览器模型加载失败";
    } finally {
      predictBtn.disabled = false;
      predictBtn.textContent = "开始预测";
    }
    return;
  }
  predictBtn.disabled = true;
  predictBtn.textContent = "预测中…";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    renderMetrics(document.getElementById("mechanical-results"), data.predictions.mechanical);
    renderMetrics(document.getElementById("physical-results"), data.predictions.physical);
    const enhanced = await addDirectDeepSeekExplanation(data, payload);
    renderExplanation(enhanced);
    renderWarnings(data.warnings);
  } catch (err) {
    renderStaticOnly(payload, `无法连接 API：${err.message}`);
  } finally {
    predictBtn.disabled = false;
    predictBtn.textContent = "开始预测";
  }
}

presetBtn.addEventListener("click", () => {
  fillComposition(PRESET_LOW_ALLOY);
  document.getElementById("material-subclass").value = "alloy_steel";
  document.getElementById("process-text").value = "900C quench + 600C temper";
});

saveDeepseekKeyBtn.addEventListener("click", saveDeepSeekDemoKey);
clearDeepseekKeyBtn.addEventListener("click", clearDeepSeekDemoKey);
deepseekKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveDeepSeekDemoKey();
  }
});

setDeepSeekKeyStatus();
predictBtn.addEventListener("click", predict);
checkHealth();
