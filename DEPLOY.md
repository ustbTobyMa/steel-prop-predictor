# GitHub Pages 部署指南（无 API 版）

本指南用于把 SteelProp 发布为 **GitHub Pages 静态网页**。当前方案不需要 Render，也不需要信用卡。

## 现在能上线什么

GitHub Pages 可以托管：

- `docs/index.html`
- `docs/styles.css`
- `docs/app.js`
- `docs/config.js`

当前网页会提供成分输入和静态机理说明。由于 GitHub Pages 不能运行后端程序，它不能直接执行 `api/` 里的 Flask 服务，也不能直接加载 `.pkl` 模型做机器学习数值预测。

DeepSeek API key 也不能放在 GitHub Pages 前端文件中；前端源码会公开给所有访问者。DeepSeek 只能由后端读取环境变量后代为调用。

## 安全边界

以下内容不会进入公开网页：

- 全量 CSV 数据集
- `thermo_explain.csv`、`metadata.csv`、`modeling_clean.csv`
- 测试集逐条预测结果

仓库里保留的 `api/` 和 `models/` 只是为了本地运行或以后接入后端服务；当前 GitHub Pages 静态网页不会直接运行它们。

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
git commit -m "Use static GitHub Pages mode without API"
git push
```

如果 GitHub 仓库的 Pages 还没打开：

1. 进入 GitHub 仓库 `ustbTobyMa/steel-prop-predictor`
2. 打开 **Settings** → **Pages**
3. **Build and deployment** → Source 选择 **GitHub Actions**
4. 等待 Actions 里的 `Deploy GitHub Pages` 运行完成

## 如果以后有 API

以后如果有不需要信用卡或学校服务器上的 Python API，先在后端设置：

```text
DEEPSEEK_API_KEY=你的新 DeepSeek key
```

然后改 `docs/config.js`：

```javascript
window.STEEL_PROP_CONFIG = {
  API_BASE: "https://your-api.example.com",
};
```

然后提交并推送，GitHub Pages 会重新发布。API 需要提供：

- `GET /api/health`
- `POST /api/predict`

仓库已经包含 `Dockerfile`，可用于 Hugging Face Spaces Docker、学校服务器或其他能保存 Secret 的服务。部署后端时不要把 key 写入代码或提交到 GitHub。

## 本地测试 API

```bash
cd steel-prop-github
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=api gunicorn api.app:app --bind 127.0.0.1:10000
curl http://127.0.0.1:10000/api/health
```

本地测试时可把 `docs/config.js` 改为：

```javascript
window.STEEL_PROP_CONFIG = {
  API_BASE: "http://127.0.0.1:10000",
};
```

测试完如果要继续发布无 API 版，再把 `API_BASE` 改回空字符串。
