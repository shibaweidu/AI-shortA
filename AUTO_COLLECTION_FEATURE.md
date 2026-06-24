# 自动采集与推荐流功能开发文档

## 目标

为首页增加自动采集能力，从 Civitai、Lexica 等图片作品站点获取作品展示图、提示词、模型参数和来源信息，经过去重、分类、审核和推荐排序后展示在首页。

该功能不应只是把外站图片贴到首页，而应形成一个可控的内容池：

- 自动采集作品图和元数据。
- 自动分类到人像、角色、场景、产品、海报、插画、风格等栏目。
- 新增推荐流，首页优先展示高质量、多样化内容。
- 全部使用源站图片 URL 展示，不转存到本地 uploads 或对象存储。
- 保留来源链接、采集记录、审核状态和下架能力。

## 当前项目关联

现有首页作品展示主要来自 `frontend/src/store/discoverStore.ts`：

- `categories`: 首页分类。
- `works`: 首页作品。

现有详情页位于：

- `frontend/src/pages/discover/DiscoverWorkDetail.tsx`

现有上传服务位于：

- `frontend/src/services/uploads.ts`
- `backend/src/server.ts` 中的上传、uploads 静态资源和对象存储逻辑。

自动采集功能可以先接入现有 discover 数据结构，后续建议迁移到后端 PostgreSQL 表，避免大量采集内容继续依赖前端 Zustand 持久化。

## 内容来源

### Civitai

优先使用官方 API 获取图片列表、prompt、模型、NSFW 标记和资源信息。

建议采集字段：

- 图片 URL。
- 原作品页面 URL。
- 图片 ID。
- 作者信息。
- prompt / negative prompt。
- 模型、LoRA、资源信息。
- seed、steps、sampler、CFG 等生成参数。
- NSFW 标记。
- 创建时间、统计数据。

### Lexica

优先使用 Lexica 搜索 API，通过关键词获取图片、prompt、尺寸、模型和 gallery 链接。

建议采集字段：

- `src`: 原图 URL。
- `srcSmall`: 缩略图 URL。
- `prompt`: 提示词。
- `width` / `height`: 图片尺寸。
- `model`: 模型。
- `guidance`: 引导参数。
- `seed`: seed。
- `nsfw`: 是否敏感。
- `gallery`: 来源页面。

## 分类设计

首页分类应简洁，适合用户浏览和做同款，不应像数据库标签一样过细。

推荐一级分类：

- 推荐
- 人像
- 角色
- 场景
- 产品
- 海报
- 插画
- 风格
- 二次元
- 3D/CG
- 国风

其中“风格”作为一个大类，承载视觉风格或生成方法，例如：

- 水彩
- 像素
- 赛博朋克
- 胶片
- 黏土
- 低多边形
- 厚涂
- 极简
- 复古
- 电影感
- 商业摄影
- UI/图标

### 分类策略

作品应同时保存主分类和多标签：

```json
{
  "category": "角色",
  "tags": ["风格:赛博朋克", "二次元", "蓝色调", "半身像"]
}
```

主分类用于首页 tab，标签用于搜索、筛选和推荐流。

自动分类应综合以下信息：

- 来源站点标签。
- prompt 关键词。
- 模型名称。
- 图片尺寸和比例。
- 视觉模型识别结果。
- 后台人工修正。

基础关键词规则：

| 分类 | 关键词示例 |
| --- | --- |
| 人像 | portrait, photo, woman, man, face, headshot, fashion, beauty |
| 角色 | character, game character, mascot, ip, chibi, avatar |
| 场景 | landscape, interior, architecture, city, room, forest, cyberpunk city |
| 产品 | product, packaging, sneaker, bottle, perfume, furniture, device |
| 插画 | illustration, children's book, flat, hand drawn, concept art |
| 海报 | poster, cover, typography, movie poster, advertising |
| 3D/CG | 3d, cgi, render, octane, blender, unreal engine |
| 二次元 | anime, manga, cel shading, waifu, japanese animation |
| 国风 | chinese, hanfu, ink, wuxia, guofeng, oriental |
| 风格 | watercolor, pixel art, clay, low poly, cyberpunk, cinematic, minimal |

## 推荐流设计

首页新增“推荐”流，推荐流不等于全部采集内容。推荐流只展示通过筛选、评分和配额控制后的作品。

推荐流来源：

- 人工精选作品。
- 最新采集作品。
- 热度较高作品。
- 同分类随机作品。
- 同风格作品。
- 用户最近浏览或做同款相关作品。

MVP 推荐评分：

```text
score =
  人工置顶权重
+ 来源热度权重
+ 新鲜度权重
+ 图片质量权重
+ 分类多样性权重
- 重复/相似惩罚
- NSFW/低质量惩罚
```

展示控制规则：

- 首页首屏加载 30-60 条。
- 每个分类最多占比 30%。
- 每个来源最多占比 50%。
- 同一关键词连续最多出现 2-3 张。
- 图片加载失败的作品自动降权或隐藏。
- 已拒绝、NSFW、低分辨率内容默认不进入推荐流。

## 图片展示策略

本功能全部采用源站 URL 展示图片，不做本地转存、不上传对象存储、不缓存缩略图。

```text
displayUrl: 实际用于前端展示的源站图片 URL。
thumbnailUrl: 如果来源 API 提供缩略图，则首页优先使用该 URL。
originalImageUrl: 来源 API 返回的原图 URL。
sourcePageUrl: 源作品页面链接，用于详情页跳转查看来源。
```

展示规则：

- 首页卡片优先使用 `thumbnailUrl || displayUrl || originalImageUrl`。
- 详情页使用 `displayUrl || originalImageUrl` 展示大图。
- 如果图片 URL 加载失败，前端上报后端。
- 后端将该作品标记为 `broken` 或直接软删除，不再进入首页和推荐流。
- 定时任务可批量检查近期展示失败的作品，清理失效 URL。

采用纯 URL 展示的优点：

- 存储成本最低。
- 采集和发布链路最轻。
- 不需要处理对象存储同步和图片转码。
- 适合先快速验证推荐流和分类效果。

风险与处理：

- 源站可能防盗链：加载失败后自动清除作品。
- 图片 URL 可能失效：失败上报后下线。
- 加载速度不可控：首页采用有限数量加载和懒加载。
- 无法保证长期稳定：推荐流每次重建时过滤失效作品。

建议字段：

```json
{
  "displayUrl": "https://source-site/image.jpg",
  "thumbnailUrl": "https://source-site/thumb.jpg",
  "originalImageUrl": "https://source-site/image.jpg",
  "sourcePageUrl": "https://source-site/work/123",
  "storageMode": "remote",
  "status": "published"
}
```

页面上公开展示 `sourcePageUrl`，图片渲染使用 `displayUrl` 或 `thumbnailUrl`。

### 图片失效清理

前端图片组件需要监听加载失败：

```text
img onError
  ↓
POST /api/collection/works/:id/broken
  ↓
后端记录 failed_at、failed_count
  ↓
达到阈值后将作品状态改为 broken 或 deleted
  ↓
首页和推荐流不再返回该作品
```

MVP 可采用一次失败即下线；正式版建议连续失败 2-3 次再清除，避免临时网络波动导致误删。

## 首页加载策略

首页不能一次性加载全部采集作品。推荐流和分类列表都采用分页加载或无限滚动。

默认规则：

- 首屏加载 30 条。
- 用户向下滚动接近底部时，再加载下一页 20-30 条。
- 单次接口最多返回 60 条。
- 每个 tab 独立分页。
- 已加载内容保留在当前页面状态中，切换 tab 时可缓存当前页结果。
- 图片使用浏览器原生 lazy loading 或前端懒加载组件。

推荐接口示例：

```text
GET /api/feed/home?cursor=xxx&limit=30
GET /api/collection/works?categoryId=xxx&cursor=xxx&limit=30
```

响应示例：

```json
{
  "items": [],
  "nextCursor": "score:123|id:work-abc",
  "hasMore": true
}
```

分页排序建议使用游标，不使用大 offset，避免作品数量变多后查询变慢。

## 作品详情页设计

点击首页某张作品后进入作品详情页。

第一屏重点展示：

- 大图预览。
- 标题。
- 主分类。
- 风格标签。
- 来源站点。
- 提示词。
- 做同款按钮。
- 复制提示词按钮。

扩展信息折叠展示：

- Negative Prompt。
- 模型。
- LoRA / Checkpoint。
- Seed。
- Sampler。
- Steps。
- CFG Scale。
- 图片尺寸。
- 比例。
- 采集时间。
- 来源链接。

操作按钮：

- 做同款。
- 复制提示词。
- 下载图片。
- 收藏。
- 查看来源。
- 举报/下架。

底部推荐：

- 相似作品。
- 同分类作品。
- 同风格作品。
- 同来源作品。

## 数据模型建议

### collected_sources

保存采集源配置。

```sql
create table collected_sources (
  id text primary key,
  provider text not null,
  name text not null,
  enabled boolean not null default true,
  query text,
  target_category_id text,
  target_tags jsonb not null default '[]'::jsonb,
  auto_publish boolean not null default false,
  filter_nsfw boolean not null default true,
  max_items_per_run integer not null default 50,
  schedule_cron text,
  last_run_at timestamptz,
  raw_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

### collected_works

保存所有采集结果，包含未发布内容。

```sql
create table collected_works (
  id text primary key,
  source_id text references collected_sources(id) on delete set null,
  provider text not null,
  source_work_id text,
  source_page_url text,
  original_image_url text not null,
  display_url text,
  thumbnail_url text,
  storage_mode text not null default 'remote',
  title text,
  prompt text,
  negative_prompt text,
  model text,
  aspect_ratio text,
  width integer,
  height integer,
  category_id text,
  tags jsonb not null default '[]'::jsonb,
  nsfw boolean not null default false,
  quality_score double precision not null default 0,
  recommendation_score double precision not null default 0,
  status text not null default 'pending',
  failed_count integer not null default 0,
  last_failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  perceptual_hash text,
  collected_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

建议唯一约束：

```sql
create unique index idx_collected_works_provider_source_work
on collected_works (provider, source_work_id)
where source_work_id is not null;

create unique index idx_collected_works_original_image_url
on collected_works (original_image_url);
```

### feed_items

保存推荐流快照，避免每次首页请求都实时计算。

```sql
create table feed_items (
  id text primary key,
  work_id text not null references collected_works(id) on delete cascade,
  feed_type text not null default 'home',
  score double precision not null default 0,
  reason text,
  rank integer not null default 0,
  created_at timestamptz not null default now()
);
```

## 后端模块设计

建议新增模块：

```text
backend/src/collectors/
  index.ts
  types.ts
  civitai.ts
  lexica.ts
  classifier.ts
  downloader.ts
  recommender.ts
```

### Provider 接口

```ts
export type CollectedCandidate = {
  provider: "civitai" | "lexica";
  sourceWorkId?: string;
  sourcePageUrl?: string;
  originalImageUrl: string;
  thumbnailUrl?: string;
  title?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  nsfw?: boolean;
  metadata?: Record<string, unknown>;
};

export interface CollectorProvider {
  collect(input: {
    query: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: CollectedCandidate[];
    nextCursor?: string;
  }>;
}
```

### 采集流程

```text
读取采集源配置
  ↓
调用 provider API
  ↓
标准化字段
  ↓
去重：source id / image url / hash / perceptual hash
  ↓
NSFW 与质量过滤
  ↓
自动分类和打标签
  ↓
保存源站图片 URL
  ↓
写入 collected_works
  ↓
自动发布或进入待审核
  ↓
刷新推荐流 feed_items
```

### 去重策略

- `provider + sourceWorkId` 去重。
- `originalImageUrl` 去重。
- 下载后计算文件 hash 去重。
- 可选：计算感知哈希，过滤视觉上近似的图片。

### 限速策略

- 每个源每次最多采集 50-200 条。
- 每个关键词每天最多采集 N 条。
- 请求失败后指数退避。
- 同源 API 设置最小请求间隔。
- 后台手动任务和定时任务共用队列，避免并发过高。

## 后台管理页面

新增后台菜单：`采集管理`。

页面一：采集源配置

- 来源：Civitai / Lexica。
- 关键词。
- 目标分类。
- 默认标签。
- 每次采集数量。
- 是否过滤 NSFW。
- 是否自动发布。
- 是否启用定时任务。
- 手动执行采集。

页面二：采集结果审核

- 预览图。
- 来源。
- 分类。
- 标签。
- prompt。
- 状态：待审核 / 已发布 / 已拒绝。
- 操作：发布、拒绝、改分类、查看来源、删除。

页面三：推荐流管理

- 查看当前推荐流。
- 手动置顶。
- 降权。
- 移除推荐。
- 按分类查看配额。

## 前端展示改造

首页：

- 新增“推荐”tab。
- 其他分类保持 tab 展示。
- 推荐流优先读取 `feed_items` 或后端推荐接口。
- 图片使用 `thumbnailUrl || displayUrl || originalImageUrl`。
- 图片加载失败时显示占位，并上报后端。

详情页：

- 支持采集作品详情。
- 显示来源、参数、标签和 URL 状态。
- 做同款时把 prompt、比例、参考图和风格标签带入首页生成器。

## API 建议

```text
GET    /api/collection/sources
POST   /api/collection/sources
PATCH  /api/collection/sources/:id
DELETE /api/collection/sources/:id

POST   /api/collection/sources/:id/run
GET    /api/collection/runs

GET    /api/collection/works?status=pending
PATCH  /api/collection/works/:id
POST   /api/collection/works/:id/publish
POST   /api/collection/works/:id/reject
POST   /api/collection/works/:id/store
DELETE /api/collection/works/:id

GET    /api/feed/home
POST   /api/feed/rebuild
PATCH  /api/feed/items/:id
```

## 合规与安全

- 优先使用官方 API。
- 不绕登录、不绕限制、不抓取需要授权的页面数据。
- 保留来源页面、作者、模型和原始元数据。
- 支持下架和重新审核。
- 默认过滤 NSFW。
- 不把外站内容宣称为本站原创。
- 对 remote 图片设置加载失败回收机制。
- 生产环境需加后台权限校验、日志和速率限制。

## 分期开发计划

### Phase 1: MVP

- 新增采集数据结构。
- 实现 Lexica provider。
- 实现 Civitai provider。
- 后台手动运行采集。
- 自动去重。
- 自动分类到现有首页分类。
- 支持 remote 展示。
- 首页新增推荐流。

### Phase 2: 审核与失效清理

- 新增采集结果审核页面。
- 支持发布、拒绝、改分类。
- 支持图片加载失败上报。
- 支持失效作品自动下线或清理。
- 详情页展示来源和完整参数。

### Phase 3: 推荐质量

- 推荐流评分。
- 分类和来源配额。
- 相似作品推荐。
- 感知哈希去重。
- 图片质量评分。
- 失败图片自动下线。

### Phase 4: 自动化

- 定时采集。
- 采集任务日志。
- 定时检查失效 URL。
- 长期未展示内容清理。
- PostgreSQL 作为主存储。

## 验收标准

- 后台可以配置并手动执行 Civitai、Lexica 采集任务。
- 采集结果能进入待审核列表。
- 发布后的作品能出现在首页推荐流和对应分类。
- 作品详情页能展示大图、prompt、来源、模型参数和做同款按钮。
- 首页一次只加载有限数量作品，不因采集数量增长而变慢。
- 图片全部使用 URL 展示，URL 失效后自动清除或下线。
- 首页支持有限数量首屏加载，用户向下滑动后继续加载下一页。
- 重复图片不会反复入库。
- NSFW 内容默认不进入公开首页。

## 当前实现状态

已完成的 MVP 能力：

- 后端使用 `data/collection-library.json` 保存采集源、采集作品和运行记录。
- 已增加 PostgreSQL 采集表迁移：`collection_sources`、`collection_works`、`collection_runs`。配置 `DATABASE_URL` 并执行 `npm run db:migrate` 后会同步写入数据库；`DB_READ_PRIMARY=postgres` 时启动优先从数据库加载采集数据。
- 支持 Civitai、Lexica 采集源配置、手动执行、批量执行启用源和定时采集。
- 手动采集、批量采集和定时采集统一进入后端采集队列，支持并发控制和失败重试。可通过 `COLLECTION_QUEUE_CONCURRENCY`、`COLLECTION_QUEUE_RETRIES` 调整。
- 采集作品全部使用源站 URL 展示，不上传对象存储。
- 支持去重、NSFW 过滤、自动分类、待审核、发布、拒绝、删除、批量操作。
- 后台采集管理页支持开启视觉模型分类，可从模型供应商中的语言/图像模型里选择分类模型。视觉分类失败时会回退到关键词规则。
- 首页读取 `/api/feed/home`，按有限数量分页加载，并支持向下滚动继续加载。
- 图片加载失败会上报 `/api/collection/works/:id/broken`，失败达到阈值后标记为 `broken`，不再进入首页。
- 后台采集管理页支持采集源管理、运行记录、作品审核、编辑分类和手动置顶。
- 首页推荐流会优先展示手动置顶作品，其次按推荐分和采集时间排序。
- 采集作品详情页展示大图、来源链接、提示词、负面提示词、模型、比例、标签和“做同款”。
- 采集作品详情页底部支持同分类/同标签相关推荐。

仍建议后续完善：

- 将首页推荐流和审核列表的分页查询进一步改为直接查询 PostgreSQL，减少大规模数据时的内存缓存压力。
- 增加更完整的采集速率限制、按来源熔断、任务取消和队列状态展示。
- 为分类规则增加后台可配置词库，并记录视觉模型分类置信度用于人工复核。
- 增加相似图去重、图片质量评分和来源配额，提升推荐流多样性。
- 增加定时 URL 健康检查任务，主动清理长期失效作品。
- 增加后台权限校验和操作审计日志。
