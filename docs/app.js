const API_BASE = (window.STEEL_PROP_CONFIG && window.STEEL_PROP_CONFIG.API_BASE) || "";

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

const grid = document.getElementById("composition-grid");
const statusBox = document.getElementById("status-box");
const predictBtn = document.getElementById("predict-btn");
const presetBtn = document.getElementById("preset-low-alloy");

function apiUrl(path) {
  if (!API_BASE || API_BASE.includes("YOUR-RENDER-APP")) {
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

function renderExplanation(payload) {
  const compBox = document.getElementById("composition-explain");
  const comp = payload.explanation?.composition_mechanism;
  compBox.classList.remove("placeholder");
  compBox.innerHTML = `
    <p>${comp?.summary || "暂无说明"}</p>
    ${comp?.mechanism_notes?.length ? `<ul>${comp.mechanism_notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
  `;
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

async function checkHealth() {
  const url = apiUrl("/api/health");
  if (!url) {
    statusBox.className = "status bad";
    statusBox.textContent = "请先在 docs/config.js 配置 Render API 地址";
    return;
  }
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      statusBox.className = "status ok";
      statusBox.textContent = "API 已连接：公开模式（不含数据库）";
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
  const url = apiUrl("/api/predict");
  if (!url) {
    alert("请先在 docs/config.js 中把 YOUR-RENDER-APP 改成你的 Render 服务地址。");
    return;
  }
  predictBtn.disabled = true;
  predictBtn.textContent = "预测中…";
  try {
    const payload = {
      material_subclass: document.getElementById("material-subclass").value,
      process_text: document.getElementById("process-text").value.trim(),
      composition: readComposition(),
    };
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
    alert(`预测失败：${err.message}`);
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

predictBtn.addEventListener("click", predict);
checkHealth();
