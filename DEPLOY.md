# GitHub Pages 部署指南（浏览器预测版）

本指南用于把 SteelProp 发布为 **GitHub Pages 静态网页 + 浏览器本地模型预测**。当前方案不需要 Render，也不需要信用卡。

## 现在能上线什么

GitHub Pages 可以托管：

- `docs/index.html`
- `docs/styles.css`
- `docs/app.js`
- `docs/browser-predictor.js`
- `docs/models/*.json`

当前网页会提供成分输入、力学/物理性能预测、规则机理说明和精简热力学参考。预测和最近邻热力学参考检索都在访问者浏览器中运行，不需要 Flask 后端。

限制：

- 首次预测需要下载约 46 MB 静态 JSON。
- 手机和慢网环境会更慢。
- DeepSeek API key 不能放在 GitHub Pages 前端文件中；如需 DeepSeek 辅助解释，必须另有后端代理。
- 完整 Thermo-Calc 数据库对照仍只保留在本地完整版；Pages 只包含派生的精简参考包。

## 安全边界

以下内容不会进入公开网页：

- 全量 CSV 数据集
- `thermo_explain.csv`、`metadata.csv`、`modeling_clean.csv`
- 测试集逐条预测结果

公开网页会包含导出的模型树结构和精简热力学参考包，因此模型和精简参考摘要本身是公开的；这和把网页部署在 GitHub Pages 上是同一安全边界。

## 部署步骤

仓库已经配置了 GitHub Pages 工作流：

```text
.github/workflows/deploy-pages.yml
```

推送 `main` 分支后，GitHub Actions 会把 `docs/` 发布到：

```text
https://ustbTobyMa.github.io/steel-prop-predictor/
```

本地提交并推送：

```bash
cd "/Users/xiaotaoma/Desktop/full thermo database/full_dataset_with_feature_doc/composition_property_thermo/steel-prop-github"
git status
git add .
git commit -m "Run LightGBM predictions in browser"
git push
```

如果 GitHub 仓库的 Pages 还没打开：

1. 进入 GitHub 仓库 `ustbTobyMa/steel-prop-predictor`
2. 打开 **Settings** → **Pages**
3. **Build and deployment** → Source 选择 **GitHub Actions**
4. 等待 Actions 里的 `Deploy GitHub Pages` 运行完成

## 更新模型

重新训练或替换 `models/` 下的 `.pkl` 后运行：

```bash
PYTHONPATH=api python3 tools/export_browser_models.py
python3 tools/export_browser_thermo_reference.py
PYTHONPATH=api python3 tests/write_browser_predictor_expected.py
node tests/browser_predictor_check.mjs
```

确认 JS 预测与 Python 参考一致后提交 `docs/models/`。

## 可选后端

只有 DeepSeek 辅助解释需要后端。后端需要设置：

```text
DEEPSEEK_API_KEY=你的新 DeepSeek key
```

然后改 `docs/config.js`：

```javascript
window.STEEL_PROP_CONFIG = {
  API_BASE: "https://your-api.example.com",
};
```

部署后端时不要把 key 写入代码或提交到 GitHub。
