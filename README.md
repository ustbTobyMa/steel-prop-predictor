# SteelProp — GitHub Pages 静态版

成分输入网页，面向 GitHub Pages 公开展示，**不含任何原始数据库 CSV**。

## 当前状态

- 网站地址：https://ustbTobyMa.github.io/steel-prop-predictor/
- 当前不依赖 Render 或其他云 API。
- GitHub Pages 只能托管静态网页，不能运行 Flask / Python / LightGBM。
- 无 API 时，页面提供成分输入和静态机理说明；机器学习数值预测需要本地运行或以后接入额外 API。

## 架构

| 组件 | 用途 | 当前 GitHub Pages 是否使用 |
|---|---|---|
| `docs/` | 静态网页 | 使用 |
| `api/` | Flask 预测 API | 不使用，保留给本地或未来后端 |
| `models/` | LightGBM 模型文件 | 不由 Pages 直接运行 |

公开版**不会**上传或暴露：

- 全量 CSV 数据集
- `thermo_explain.csv` / `metadata.csv` / `modeling_clean.csv`
- 测试集逐条预测结果

## 发布到 GitHub Pages

推送 `main` 分支后，`.github/workflows/deploy-pages.yml` 会把 `docs/` 自动发布到 GitHub Pages。

```bash
cd "/Users/xiaotaoma/Desktop/full thermo database/full_dataset_with_feature_doc/composition_property_thermo/steel-prop-github"
git add .
git commit -m "Use static GitHub Pages mode without API"
git push
```

详细说明见 [DEPLOY.md](./DEPLOY.md)。

## 本地完整预测

如果需要真正的模型数值预测，可以在本机运行 API：

```bash
cd steel-prop-github
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=api gunicorn api.app:app --bind 127.0.0.1:10000
```

然后把 `docs/config.js` 里的 `API_BASE` 改成本地地址 `http://127.0.0.1:10000` 做本地测试。

完整功能（含相近材料热力学解释）仍在上级目录的本地完整版中运行，数据库不离开本机。
