const API_BASE = ((window.STEEL_PROP_CONFIG && window.STEEL_PROP_CONFIG.API_BASE) || "").trim();

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
  const aiBox = document.getElementById("ai-explain");
  const comp = payload.explanation?.composition_mechanism;
  const ai = payload.explanation?.deepseek;
  compBox.classList.remove("placeholder");
  compBox.innerHTML = `
    <p>${comp?.summary || "暂无说明"}</p>
    ${comp?.mechanism_notes?.length ? `<ul>${comp.mechanism_notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
  `;
  if (ai?.status === "ok" && ai.text) {
    aiBox.classList.remove("hidden");
    aiBox.innerHTML = `<strong>AI 辅助解释</strong>${paragraphs(ai.text)}`;
  } else if (ai?.enabled && ai.status !== "ok") {
    aiBox.classList.remove("hidden");
    aiBox.innerHTML = `<strong>AI 辅助解释暂不可用</strong><p>${escapeHtml(ai.error || ai.status)}</p>`;
  } else {
    aiBox.classList.add("hidden");
    aiBox.innerHTML = "";
  }
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
    statusBox.textContent = "GitHub Pages 静态版：未连接模型 API";
    predictBtn.textContent = "生成静态说明";
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
    renderStaticOnly(payload);
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
    renderExplanation(data);
    renderWarnings(data.warnings);
  } catch (err) {
    renderStaticOnly(payload, `无法连接 API：${err.message}`);
  } finally {
    predictBtn.disabled = false;
    predictBtn.textContent = "开始预测";
    if (!apiUrl("/api/health")) {
      predictBtn.textContent = "生成静态说明";
    }
  }
}

presetBtn.addEventListener("click", () => {
  fillComposition(PRESET_LOW_ALLOY);
  document.getElementById("material-subclass").value = "alloy_steel";
  document.getElementById("process-text").value = "900C quench + 600C temper";
});

predictBtn.addEventListener("click", predict);
checkHealth();
