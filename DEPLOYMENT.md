# CreatorTrack 部署指南

本项目是前后端分离架构：

```text
Cloudflare Pages 前端
  -> /api Pages Function 代理
  -> Render Node.js 后端
  -> YouTube Data API
  -> Render 持久化磁盘里的 SQLite 数据库和导出文件
```

## 1. 上传 GitHub 前检查

根目录已经提供 `.gitignore`，会排除这些本地文件：

```text
.env
.env.*
backend/.env
frontend/.env.local
node_modules/
frontend/dist/
backend/data/*.sqlite
backend/data/youtube-api-cache.json
backend/data/exports/*
logs/
*.log
```

不要上传真实 API Key、本地 SQLite 数据库、导出的 XLSX 文件和日志。

如果你的电脑还没有 Git，可以先安装 Git 或 GitHub Desktop。

命令行上传：

```powershell
cd "D:\市场部\youtube-creator-finder0603"
git init
git add .
git commit -m "Initial CreatorTrack deployment"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/creatortrack.git
git push -u origin main
```

如果之后发现 `.env` 或本地数据曾经被加入 Git 索引，执行：

```powershell
git rm --cached backend/.env frontend/.env.local backend/data/creator-pipeline.sqlite backend/data/youtube-api-cache.json
git rm --cached -r backend/data/exports logs
git add .gitignore
git commit -m "Remove local secrets and generated data"
```

## 2. 部署后端到 Render

Render 可以直接读取根目录的 `render.yaml` 创建后端服务。

推荐方式：

1. 打开 Render Dashboard。
2. New -> Blueprint。
3. 连接你的 GitHub 仓库。
4. 选择本项目仓库。
5. Render 会读取 `render.yaml` 并创建 `creatortrack-api`。

`render.yaml` 已设置：

```text
Root directory: backend
Build command: npm ci && npm run typecheck
Start command: npm start
Health check: /health
Persistent disk: /var/data
DATABASE_PATH=/var/data/creator-pipeline.sqlite
EXPORT_DIR=/var/data/exports
```

在 Render 后端服务的 Environment 页面补充：

```text
YOUTUBE_API_KEY=你的 YouTube Data API Key
APP_BASE_URL=https://你的-cloudflare-pages域名.pages.dev
MINIMAX_API_KEY=可选
```

Render 会自动提供 `PORT`，不要手动固定端口。

部署完成后检查：

```text
https://你的-render后端.onrender.com/health
```

预期返回：

```json
{"ok":true,"service":"youtube-creator-pipeline-backend"}
```

## 3. 部署前端到 Cloudflare Pages

1. 打开 Cloudflare Dashboard。
2. Workers & Pages -> Create application -> Pages。
3. 连接你的 GitHub 仓库。
4. 使用这些构建设置：

```text
Framework preset: Vite
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

设置 Cloudflare Pages 环境变量：

```text
VITE_API_BASE_URL=/api
BACKEND_BASE_URL=https://你的-render后端.onrender.com
```

说明：

- `VITE_API_BASE_URL=/api` 会让浏览器请求 Cloudflare Pages 自己的 `/api/*`。
- `frontend/functions/api/[[path]].ts` 会把 `/api/*` 转发到 Render 后端。
- `BACKEND_BASE_URL` 是 Pages Function 使用的后端地址。

修改环境变量后需要重新部署一次 Pages。

## 4. 联通检查

后端：

```text
https://你的-render后端.onrender.com/health
```

Cloudflare 代理：

```text
https://你的-pages站点.pages.dev/api/health
```

前端：

```text
https://你的-pages站点.pages.dev
```

如果页面打开但搜索失败，优先检查：

```text
Cloudflare Pages:
VITE_API_BASE_URL=/api
BACKEND_BASE_URL=https://你的-render后端.onrender.com

Render:
YOUTUBE_API_KEY=你的真实 Key
APP_BASE_URL=https://你的-pages站点.pages.dev
```

## 5. 本地开发

后端：

```powershell
cd "D:\市场部\youtube-creator-finder0603\backend"
npm install
npm run typecheck
npm test
npm run dev
```

前端：

```powershell
cd "D:\市场部\youtube-creator-finder0603\frontend"
npm install
npm run typecheck
npm run build
npm run dev
```

本地环境变量样例：

```text
.env.example
backend/.env.example
frontend/.env.example
```

本地访问：

```text
Frontend: http://127.0.0.1:3000
Backend:  http://127.0.0.1:3011/health
```

## 6. 可选 Worker 代理

仓库中还有独立 Worker 代理：

```text
cloudflare/api-proxy
```

大多数情况下不需要使用它，因为 Cloudflare Pages Function 已经能代理 `/api/*` 到 Render。只有当你想单独维护一个固定 API 网关时，再部署这个 Worker。
