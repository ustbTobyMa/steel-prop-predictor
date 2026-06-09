# SteelProp — 公开部署版

成分输入 → 力学/物理性能预测 Web 应用（**不含任何原始数据库 CSV**）。

## 架构

| 组件 | 托管 | 内容 |
|---|---|---|
| `docs/` | **GitHub Pages** | 静态网页 |
| `api/` + `models/` | **Render**（免费层） | 预测 API + 训练好的模型 |

公开版**不会**上传或暴露：
- 全量 CSV 数据集
- `thermo_explain.csv` / `metadata.csv` / `modeling_clean.csv`
- 测试集逐条预测结果

仅包含 **LightGBM 模型文件**（`.pkl`），用于在线推理。

## 本地测试 API

```bash
cd steel-prop-github
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=api gunicorn api.app:app --bind 127.0.0.1:10000
curl http://127.0.0.1:10000/api/health
```

## 部署

详见 [DEPLOY.md](./DEPLOY.md)。

## 本地完整版（含 Thermo-Calc 数据库对照）

完整功能（含相近材料热力学解释）请在本机运行上级目录的 `composition_property_thermo/run_webapp.sh`，数据库不离开本地。
