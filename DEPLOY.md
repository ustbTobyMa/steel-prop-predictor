# GitHub + Render 部署指南

本指南帮助你在 **不暴露数据库** 的前提下，把 SteelProp 网站发布到 GitHub。

## 安全说明

以下内容 **不会** 进入 GitHub 仓库（已在 `.gitignore` 中排除）：

- `*.csv` / `*.jsonl` 等原始或清洗后的数据表
- `thermo_explain.csv`、`metadata.csv`、`modeling_clean.csv`
- 全量钢铁热力学数据集

仓库中仅包含：
- 前端静态页面（`docs/`）
- 预测 API 代码（`api/`）
- 训练好的模型权重（`models/*.pkl`，约 69MB）

公开版 **不提供** 数据库相近材料 Thermo-Calc 对照；该功能仅保留在本地完整版。

---

## 第一步：创建 GitHub 仓库

1. 打开 GitHub → **New repository**
2. 名称：`steel-prop-predictor`（仓库地址将是 `https://github.com/ustbTobyMa/steel-prop-predictor`）
3. 可见性：Public（GitHub Pages 免费）或 Private（需 GitHub Pro 才能用 Pages）
4. **不要** 勾选 “Add a README”

在终端执行：

```bash
cd "/Users/xiaotaoma/Desktop/full thermo database/full_dataset_with_feature_doc/composition_property_thermo/steel-prop-github"

git init
git add .
git commit -m "Initial public deploy: web UI + API + models (no dataset)"
git branch -M main
git remote add origin https://github.com/ustbTobyMa/steel-prop-predictor.git
git push -u origin main
```

> 若模型文件超过 GitHub 单文件 100MB 限制，需改用 [Git LFS](https://git-lfs.github.com/) 推送 `models/`。

---

## 第二步：开启 GitHub Pages

1. 仓库 → **Settings** → **Pages**
2. **Build and deployment** → Source 选 **GitHub Actions**
3. 推送 `main` 分支后，Actions 工作流 `Deploy GitHub Pages` 会自动运行
4. 部署完成后访问：`https://ustbTobyMa.github.io/steel-prop-predictor/`

---

## 第三步：部署 API 到 Render（免费）

GitHub Pages 只能托管静态网页，预测 API 需要单独部署。

### 方式 A：一键部署（推荐）

1. 打开 README 里的 **Deploy to Render** 按钮，或直接访问：  
   https://render.com/deploy?repo=https://github.com/ustbTobyMa/steel-prop-predictor
2. 用 GitHub 登录 Render 并授权
3. 确认读取到 `render.yaml`，点击 **Apply**
4. 等待 `steel-prop-api` 服务变为 **Live**
5. 复制服务 URL（通常为 `https://steel-prop-api.onrender.com`）

### 方式 B：手动 Blueprint

1. 注册 [Render](https://render.com/)
2. **New** → **Blueprint** → 连接 `ustbTobyMa/steel-prop-predictor`
3. 按提示完成部署

验证：

```bash
curl https://steel-prop-api.onrender.com/api/health
```

---

## 第四步：把 API 地址写入前端配置

编辑仓库中的 `docs/config.js`：

```javascript
window.STEEL_PROP_CONFIG = {
  API_BASE: "https://steel-prop-api.onrender.com",
};
```

提交并推送：

```bash
git add docs/config.js
git commit -m "Point frontend to Render API"
git push
```

等待 GitHub Pages 重新部署后，打开 Pages 网址即可使用。

---

## 常见问题

### Pages 打开后提示“请配置 Render API 地址”

说明 `docs/config.js` 里仍是 `YOUR-RENDER-APP`，按第四步修改。

### Render 首次请求很慢

免费实例会休眠，首次访问需等待约 30–60 秒唤醒。

### 想恢复 Thermo-Calc 数据库对照

那是本地完整版功能，涉及私有 CSV，**不应** 上传到 GitHub。请在本机运行：

```bash
cd composition_property_thermo
./run_webapp.sh
```

### 如何更新模型

1. 在本机重新训练：`python3 train_models.py`
2. 运行同步脚本（如有）或手动复制 `model_outputs/*/target_*/best_model.pkl` 到 `steel-prop-github/models/`
3. 提交并推送；Render 会自动重新部署

---

## 目录结构

```
steel-prop-github/
├── docs/                 # GitHub Pages 静态站
├── api/                  # Flask API
├── models/               # 仅 .pkl + feature_spec.json
├── .github/workflows/    # Pages 自动部署
├── render.yaml           # Render 一键部署
├── requirements.txt
└── .gitignore            # 阻止 CSV 数据入库
```
