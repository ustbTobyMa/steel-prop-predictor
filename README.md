# SteelProp — GitHub Pages 浏览器预测版

成分输入网页，面向 GitHub Pages 公开展示，**不含任何原始数据库 CSV**。

## 当前状态

- 网站地址：https://ustbTobyMa.github.io/steel-prop-predictor/
- GitHub Pages 直接托管 `docs/` 静态网页。
- 12 个 LightGBM 模型已导出为浏览器可读取的 JSON，网页会在访问者浏览器本地完成数值预测。
- 首次预测会下载约 36 MB 模型 JSON；后续通常由浏览器缓存。
- DeepSeek API key 必须放在后端环境变量 `DEEPSEEK_API_KEY`，不能写进 `docs/` 前端文件。

## 架构

| 组件 | 用途 | 当前 GitHub Pages 是否使用 |
|---|---|---|
| `docs/` | 静态网页 + 浏览器推理 JS | 使用 |
| `docs/models/` | 导出的 LightGBM JSON 模型 | 使用 |
| `api/` | Flask 预测 API + DeepSeek 代理 | 可选后端 |
| `models/` | 原始 Python `.pkl` 模型 | 用于重新导出前端模型 |

公开版**不会**上传或暴露：

- 全量 CSV 数据集
- `thermo_explain.csv` / `metadata.csv` / `modeling_clean.csv`
- 测试集逐条预测结果

## 发布到 GitHub Pages

推送 `main` 分支后，`.github/workflows/deploy-pages.yml` 会把 `docs/` 自动发布到 GitHub Pages。

```bash
cd "/Users/xiaotaoma/Desktop/full thermo database/full_dataset_with_feature_doc/composition_property_thermo/steel-prop-github"
git add .
git commit -m "Run LightGBM predictions in browser"
git push
```

## 重新导出浏览器模型

如果更新了 `models/` 里的 `.pkl`，重新生成前端模型：

```bash
PYTHONPATH=api python3 tools/export_browser_models.py
```

然后运行一致性检查：

```bash
PYTHONPATH=api python3 tests/write_browser_predictor_expected.py
node tests/browser_predictor_check.mjs
```

## DeepSeek 辅助解释

浏览器版可以直接显示模型数值预测，但 DeepSeek 不能直接从前端调用。若要启用 DeepSeek 辅助解释，需要部署 `api/` 后端并设置：

```text
DEEPSEEK_API_KEY=你的新 DeepSeek key
```

然后把 `docs/config.js` 里的 `API_BASE` 改成后端 HTTPS 地址。
