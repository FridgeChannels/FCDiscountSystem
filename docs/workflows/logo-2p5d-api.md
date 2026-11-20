# 平面 Logo 转透明 2.5D 图片

`POST /api/fc/brand-assets/logo-2p5d` 接收一张静态 Logo，返回 PNG 或 WebP 图片二进制。上传素材库后，可将访问地址写入对应品牌的 `magnet_brand_param.brand_wordmark_url`。接口本身不上传 S3、不写数据库。

## 三种渲染方式

| `style` | 适用图形 | 处理过程 |
| --- | --- | --- |
| `silhouette` | 单色字标、实心剪影 | 本地计算笔画倒角、轮廓高光和右下侧面 |
| `flat` | 多色扁平图标 | 本地保留色块正面、添加窄高光和侧边 |
| `illustration` | 吉祥物、复杂插画、细线稿、已有明暗的图案 | AI 重绘主体体积、材质光影、前后分层和字标倒角，不再使用旧版浅侧边算法 |

默认 `style=auto`：去底裁边后，根据颜色、内部变化与线条密度自动分类；判断为 `illustration` 时进入同一条 AI 重绘流程。自动模式也应携带编辑令牌，因为输入可能被识别为插画。

## 插画模式：AlaSkins 样图的制作流程

1. 校验并解码原 Logo，按 `background` 处理外部底色。SVG 先转为 PNG；品牌原图是唯一身份来源。
2. 将处理后的原图及内置的宠物立体设计参考图 `server/logo-relief/reference/pet-depth.png` 一起送入图像编辑服务。参考图就是用户提供的原始截图，随项目分发，不依赖桌面路径。
3. 固定指令要求主体具有圆润体积、自然材质细节和左上柔光；已有背景后退成分层浮雕，字标成为独立前景。保留原有主体、姿态、朝向、构图、配色、文字拼写和字形，不把参考图里的狗、界面、颜色或文字复制到其他品牌中。
4. 服务使用 OpenAI Images Edit API、`gpt-image-2.5-sunburst`，每次请求生成一张高质量 1024 × 1024 透明 PNG。完成后验证文件可解码、同时含完全透明与可见像素，再按 `size` 等比缩放，输出 PNG 或无损 WebP。

这复用了已认可样图的“原图 + 同一参考图 + 立体重绘指令”方法。聊天内置生图工具不公开实际模型配置；本接口采用项目已有的 API 图像模型，因此不是对聊天工具的直接调用，也不保证逐像素复现。每次生成可能略有差异，品牌字形、细节和立体效果仍需查看结果确认；透明度与文件检查不等同于文字或画面质量检查。

## 服务端配置

项目根目录 `.env` 或进程环境设置：

- `OPENAI_API_KEY`：具备图像模型调用权限的服务端密钥。
- `LOGO_IMAGE_EDIT_TOKEN`：插画编辑调用令牌；未配置时复用已有的 `PRODUCT_IMAGE_EDIT_TOKEN`。

单色及扁平图的本地渲染不需要这两项。插画模式缺少配置返回 503，调用令牌无效返回 401，不会降级为旧版轮廓加厚。

## 调用

在终端设置好调用令牌后，上传原始图片字节：

```sh
curl --fail-with-body --max-time 270 \
  'http://localhost:3001/api/fc/brand-assets/logo-2p5d?style=illustration&format=png' \
  -H "Authorization: Bearer ${LOGO_IMAGE_EDIT_TOKEN:-$PRODUCT_IMAGE_EDIT_TOKEN}" \
  -H 'Content-Type: image/webp' \
  --data-binary @server/logo-relief/fixtures/alaskins.webp \
  -o alaskins-2p5d.png
```

通过前端代理也可使用 `http://localhost:5180`。请求体为原始文件字节，Content-Type 支持 `image/svg+xml`、`image/png`、`image/webp`、`image/jpeg`。单张上限 1 MiB，解码尺寸上限 1600 万像素。推荐透明 PNG 或文字已转路径的 SVG；SVG 必须为独立 UTF-8 文件，不含 DTD。

| 查询参数 | 默认值 | 含义 |
| --- | --- | --- |
| `size` | `900` | 输出画布最长边，128–1200 像素，等比缩放 |
| `format` | `webp` | 无损 `webp` 或 `png` |
| `style` | `auto` | `auto`、`silhouette`、`flat`、`illustration` |
| `color` | 原图配色 | 六位 RGB 色值。本地渲染按该色着色；AI 模式将该色作为统一材质色指导，保留明暗变化 |
| `background` | `auto` | 沿用透明度，或去除与边缘连通的均匀底色；`keep` 保留原底板作为 Logo 的一部分 |

本地预处理最长 15 秒，AI 编辑另限 240 秒。调用方与代理需留出至少 270 秒，项目 Nginx 已配置对应超时。每个服务进程同时最多处理两张 Logo。客户端断开时取消上游等待；取消不保证供应商停止计费。

`scripts/backfill-brand-wordmarks.mjs` 已适配调用令牌及超时。没有运行全量回填。每次插画重绘会调用付费图像服务，服务端不自动重试，也不在失败时返回旧版效果；调用方不要因短超时重复提交。批量脚本只自动重试附带 `Retry-After` 的本地繁忙响应。

## 响应与验证

### 用量记录

插画 AI 调用从现在起会追加保存到项目 `data/logo-usage/usage.jsonl`，可用服务端 `LOGO_USAGE_LOG_DIR` 改变目录。Docker 使用持久卷 `logo_usage`，容器重建后保留。文件不进入 Git，不保存密钥、完整图片或提示词。

每次调用先写 `started` 记录，再写供应商响应或 `usage_unavailable`，通过相同 `id` 关联。保存 UTC 时间、模型、生成参数、源图 SHA-256、供应商 `x-request-id`、HTTP 状态、耗时和原始 `usage`。即使生成图片未通过透明度检查，已经返回的用量也会保留。只有开始记录而没有后续记录时，表示调用未正常结束，用量未知，不代表免费。

`estimatedCost` 使用 2026-11-20 核对的 Standard 单价估算美元费用：文字输入 $5/百万 tokens、图像输入 $8/百万 tokens、图像输出 $30/百万 tokens。记录内包含价格日期、来源和 `estimate_not_invoice` 标记；它不是实际账单。缺少 token 明细、模型不匹配或出现不支持的缓存明细时保存 `null`，不猜测或记作零。供应商真实扣费以账单为准。

开始前无法写日志会返回 503，不发起付费请求；请求完成后若磁盘突然不可写，完整用量记录输出到服务错误日志（`logo-usage-persist-failed`），仍交付已生成图片。日志采用追加方式，需按部署环境归档管理。此前未保存的历史用量无法补回。测试写入独立临时目录，不污染真实记录，也不调用付费模型。

成功返回 `200 image/webp` 或 `200 image/png`：

- `X-Logo-Style`：实际分类。
- `X-Logo-Renderer`：`local` 或 `ai`。
- `X-Logo-Model`：AI 模式所用模型。

失败返回 JSON 的 `error` 字段。400 为参数或空请求错误；401 为编辑令牌无效；405 为方法错误；413 为文件超限；415 为不支持的媒体类型；422 为图像无效、无法自动去底或上游拒绝；429 为本地繁忙（附 `Retry-After`）或上游限额；502 为上游失败或输出不是有效透明图片；503 为配置/模型权限问题或本地渲染超时；504 为 AI 编辑超时。已进入 AI 调用的错误响应也带 `X-Logo-Renderer: ai`，便于调用方避免把它当作源图格式问题重复提交。

运行 `npm run test:logo` 验证自动分类、请求参数、鉴权、透明输出、原有本地渲染、失败映射、并发上限及断开取消。测试使用模拟上游，不产生图像生成费用。

API 参数依据：[OpenAI 图像编辑文档](https://developers.openai.com/api/reference/resources/images/methods/edit)。
