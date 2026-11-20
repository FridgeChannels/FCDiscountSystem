# 平面 Logo 转透明 2.5D 图片

`POST /api/fc/brand-assets/logo-2p5d` 接收一张静态 Logo，直接返回渲染好的图片二进制。可以在品牌素材上传时调用一次，把返回文件存入素材库，将该文件的可访问地址填入品牌配置的 `wordmarkUrl`。

## 调用

在 FCDiscountSystem 项目目录执行。下面的命令用原始 Mosh Logo 生成透明 WebP。

```sh
curl --fail-with-body 'http://localhost:5180/api/fc/brand-assets/logo-2p5d' \
  -H 'Content-Type: image/png' \
  --data-binary @public/reorder/mosh/logo.png \
  -o mosh-2p5d.webp
```

请求体为原始文件字节，Content-Type 使用 `image/svg+xml`、`image/png`、`image/webp` 或 `image/jpeg`。单张上限 1 MiB，解码尺寸上限 1600 万像素。推荐使用已经转为路径的 SVG 或透明 PNG，以保留细节和原字形。SVG 应为独立、UTF-8 编码、不含 DTD 的文件。

| 查询参数 | 默认值 | 含义 |
| --- | --- | --- |
| `size` | `900` | 输出画布最长边，128 至 1200 像素，包含透明安全边距 |
| `format` | `webp` | `webp`（无损）或 `png` |
| `style` | `auto` | 自动选择渲染方式，也可以指定 `silhouette`、`flat` 或 `illustration` |
| `color` | 原图配色 | 六位 RGB 色值，如 `681cab`。指定时，所有可见图形使用同一种材质色 |
| `background` | `auto` | 沿用已有透明度。对边缘底色一致的不透明图，去除与画布边缘连通的底色区域。单色剪影可恢复同底色的字孔。`keep` 保留输入底板 |

## 如何生成

自动模式在去底、裁边之后分析图形的颜色分布、内部颜色变化和线条密度。细线、渐变或难以判断的复杂图案优先采用插画处理。可以通过响应头 `X-Logo-Style` 查看此次实际使用的模式。

| 渲染方式 | 适用图形 | 处理效果 |
| --- | --- | --- |
| `silhouette` | 单色字标、实心剪影，如 Mosh | 按笔画厚度估算倒角宽度，沿外轮廓和镂空打光，向右下方生成侧面 |
| `flat` | 多色扁平图标 | 各色块共用一个正面，沿透明轮廓生成窄高光，保留内部色块的颜色和交界线 |
| `illustration` | 吉祥物、细线稿、已有明暗层次的图案，如 Heavenly Hounds | 保留正面原色和描边，在后方生成浅侧边与投影。显式传入 `color` 时按该颜色统一着色 |

三种模式都预留侧边和投影空间，再把裁好的图形缩放至输出尺寸。插画有封闭留白需要镂空时，请上传带透明通道的原稿。

成功响应为 HTTP 200，Content-Type 为 `image/webp` 或 `image/png`。HTTP 错误以 JSON 对象的 `error` 字段说明原因。参数或请求体无效返回 400，方法错误为 405，文件过大为 413，未支持的媒体类型为 415。源图损坏、全透明或无法辨识纯色背景时返回 422。渲染繁忙返回 429（附 Retry-After），渲染超时返回 503。
