# MEMORY.md

## 项目定位

当前项目是一个本地优先的 **Quota-safe YouTube Channel Intelligence System**，从原始 YouTube creator finder 演进而来。目标是发现、分析、筛选 YouTube 博主，并以频道维度输出可用于合作/外联的情报数据。项目必须保持增量开发，不允许重构或重写整体架构，不允许破坏原有视频搜索、评分、导出等功能。

项目路径：

```text
D:\市场部\AI项目\youtube-creator-finder-master
```

便携 Node 路径：

```text
D:\市场部\AI项目\node-v22.13.1-win-x64
```

本地服务：

```text
Frontend: http://127.0.0.1:3000
Backend:  http://localhost:3011
Health:   http://localhost:3011/health
```

推荐启动脚本：

```text
scripts/start-backend-local.ps1
scripts/start-frontend-local.ps1
```

Windows 中文路径下优先使用 `.ps1`，不要优先用 `.cmd`。

## 环境变量

根目录 `.env`：

```text
YOUTUBE_API_KEY=
PORT=3011
APP_BASE_URL=http://localhost:3000
DEFAULT_SUB_MIN=3000
DEFAULT_SUB_MAX=50000
DEFAULT_MAX_CANDIDATES=200
DEFAULT_LOOKBACK_DAYS=30
EXPORT_DIR=./data/exports
```

前端：

```text
frontend/.env.local
VITE_API_BASE_URL=http://localhost:3011
```

不要提交 `.env`、数据库、缓存、导出文件、日志。

## 当前数据流

核心流程：

```text
筛选条件/关键词
  -> 动态生成 YouTube search query
  -> search.list 候选扫描
  -> videos.list 视频指标补全
  -> channels.list 频道指标补全
  -> channel intelligence enrichment
  -> deterministic pre_score
  -> shortlist
  -> 频道维度前端展示
  -> 频道维度 XLSX/CSV 导出
```

数据库仍以 `results` 保存视频级候选，保持兼容；前端和导出当前按 `channel_id` 聚合去重后展示频道数据。之前“Excel 比网站多”的原因是 Excel 导出了视频级 results，而网站展示频道级 channels；已修复为导出按频道去重后的代表结果，和网站数量一致。

## 前端筛选系统

当前前端筛选已重构为组件化：

```text
frontend/src/components/FilterPanel.tsx
```

筛选状态集中在 `App.tsx` 的单个 `filters` React state 中，不再分散维护多个 filter state。未使用 Zustand。

筛选项：

- 内容类型：全部 / 视频 / 短视频 / 直播
- 地区：下拉选择
- 粉丝量范围：最小值 + 最大值，均可为空
- 语言：下拉选择

已移除旧默认值：

- 不再默认最小粉丝 `3000`
- 不再默认最大粉丝 `50000`
- 不再默认 `pre_score = 55`

搜索逻辑改为动态生成 query：

```text
keyword + content type query + region query + language query
```

如果关键词为空，会用筛选条件生成 query；如果全部为空，则 fallback 为 `youtube creator`，避免空 query。

关键文件：

```text
frontend/src/App.tsx
frontend/src/components/FilterPanel.tsx
frontend/src/types.ts
frontend/src/lib/api.ts
frontend/src/styles.css
```

## 后端筛选参数

`createJobSchema` 已支持：

```text
content_type: all | video | short | live
region: string
language: string
subscriber_min: number | null
subscriber_max: number | null
minimum_pre_score: number | null
```

后端存储时空值会转为 `0` 表示“不限制”。`jobs` 表已新增：

```text
content_type
region
language
```

`initializeDatabase()` 里有兼容旧库的 guarded `ALTER TABLE`。

YouTube 搜索参数映射：

```text
short -> videoDuration=short
video -> videoDuration=medium
live  -> eventType=live
region -> regionCode
language -> relevanceLanguage
```

## 频道情报输出

Job detail API 返回 `channels`，格式：

```json
{
  "channel_name": "",
  "channel_id": "",
  "channel_url": "",
  "country": "",
  "language": "",
  "email": null,
  "description": "",
  "subscriber_count": 0,
  "video_count": 0,
  "similar_channels": [
    {
      "channel_name": "",
      "channel_id": ""
    }
  ]
}
```

相关模块：

```text
backend/src/services/channelIntelligence/channelIntelligenceService.ts
backend/src/services/channelIntelligence/languageDetector.ts
backend/src/services/channelIntelligence/emailExtractor.ts
backend/src/services/channelIntelligence/countryMap.ts
backend/src/services/channelIntelligence/dedupe.ts
backend/src/services/channelEnrichmentService.ts
```

要求：

- 语言识别基于频道名、频道描述、视频标题，失败返回 `unknown`
- 邮箱只从公开信息提取，不能登录或绕过验证
- 国家 code 用静态表转英文全称，未知则返回原值
- 相似频道最多 5 个，排除当前频道，并按 `channel_id` 去重
- 所有异常返回默认值，不中断主流程

## Quota-safe API 架构

所有 YouTube API 请求必须经过统一入口：

```text
backend/src/api/youtubeApiWrapper.ts
youtubeApiRequest()
```

禁止业务模块直接请求 `googleapis.com/youtube/v3`。

相关模块：

```text
backend/src/api/quotaManager.ts
backend/src/api/rateLimiter.ts
backend/src/api/cacheLayer.ts
backend/src/api/youtubeApiWrapper.ts
```

强制数据流：

```text
Request -> Rate Limit Check -> Quota Check -> Cache Check -> API Call -> Cache Save -> Return
```

限流规则：

```text
search.list:   1 次 / 5 秒
channels.list: 5 次 / 秒
videos.list:   10 次 / 秒
```

Quota：

```text
Daily budget: 10000 units
search.list: 100 units
channels.list: 1 unit
videos.list: 1 unit
```

当剩余额度低于 200 units，禁止 `search.list`，优先返回缓存，无缓存则返回 fallback，不抛错。

缓存：

```text
Channel/search/video: 24 小时
Similar channels: 7 天
Cache file: backend/data/youtube-api-cache.json
```

`search.list` 已限制为单页，避免循环 search；搜索 cache key 已按日期归一化，提升同日重复搜索命中率。

## 评分规则

`AGENTS.md` 中的 scoring formulas 是强制产品规则，不能擅自修改。尤其：

- `pre_score` 必须确定性计算
- 不允许让绝对播放量成为主导因素
- 改公式必须同步改测试
- MiniMax 不得计算最终分数

## 常用命令

运行命令前设置 PATH：

```powershell
$env:PATH="D:\市场部\AI项目\node-v22.13.1-win-x64;$env:PATH"
```

后端：

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master\backend"
npm run typecheck
npm test
npm run db:init
```

前端：

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master\frontend"
npm run typecheck
npm run build
```

最近验证状态：

```text
Backend typecheck: passed
Backend tests: 13 files / 40 tests passed
Frontend typecheck: passed
Frontend build: passed
Health endpoint: ok
```

关键测试：

```text
backend/tests/schema.test.ts
backend/tests/youtubeService.test.ts
backend/tests/channelIntelligenceService.test.ts
backend/tests/quotaSafety.test.ts
backend/tests/scoringService.test.ts
backend/tests/exportService.test.ts
```

## 注意事项

- 如果前端打不开，先检查 `3000` 和 `3011` 是否监听，通常是 dev server 停了。
- 如果 YouTube API 出现 `fetch failed EACCES`，可能是 Codex 沙盒网络限制；用本地 PowerShell 脚本启动后端。
- Git 可能不可用，不要依赖 git 命令。
- 不要执行破坏性命令，例如 `git reset --hard` 或删除用户文件。
- Vercel/Cloudflare 部署兼容性要求：前端通过 `VITE_API_BASE_URL` 访问 API，不允许 UI 直接调用 YouTube API。
