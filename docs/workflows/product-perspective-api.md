# 商品原图生成 2.5D 透明主图

`POST /api/fc/brand-assets/product-2p5d/edit` 每次编辑一张商品图，返回一张静态、带透明度的 PNG。它复用 Maytag 奶酪样图的制作过程。新商品只需提供自己的原图。

## 输入与处理

1. 第一张图提供商品身份，包括外形、包装、组合数量、配色、品牌标识和正面标签。
2. 服务自动将项目内的原始牛排设计参考图作为第二张图，指示模型借用近大远小、边缘轮廓、遮挡和布光。参考图随服务一起分发。
3. 固定编辑指令要求保留清晰可辨的主面，采用轻微俯视、约 20–25° 的三分之四视角，按商品材质重现侧面厚度、反光和褶皱暗部，完整保留轮廓。角度是生成指导，不是三维几何测量值。
4. 服务请求一张高质量、1024 × 1024 的透明 PNG，并在返回前解码检查，要求同时有完全透明和可见像素。模型会推断原照片看不到的侧面。包装细字、重量、Logo 和推断出的侧面应对照原图复核。

## 配置

在服务端环境或项目根目录的本地 `.env` 设置以下两项，随后重启本项目后端：

- `OPENAI_API_KEY` 用于调用图像编辑服务，需要具备图像模型调用权限。
- `PRODUCT_IMAGE_EDIT_TOKEN` 为这个项目单独设置的调用令牌。可用 `openssl rand -hex 32` 生成。调用方使用同一个值，OpenAI 密钥只放在服务端。

服务调用 [OpenAI 图像编辑 API](https://developers.openai.com/api/reference/resources/images/methods/edit)，使用 `gpt-image-2.5-sunburst`，每个请求生成一次。服务等待上游的最长时间为 240 秒。

## 使用商品 URL

在调用方的终端设置好同名调用令牌后运行。图片 URL 需能由图像服务直接通过 HTTPS 读取。

```sh
curl --fail --show-error --max-time 260 \
  'http://localhost:5180/api/fc/brand-assets/product-2p5d/edit' \
  -H "Authorization: Bearer ${PRODUCT_IMAGE_EDIT_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"imageUrl":"https://cdn.shopify.com/s/files/1/0690/2140/1408/files/202307MDF-0129.png?v=1764194181"}' \
  -o maytag-2p5d.png
```

## 上传本地文件

```sh
curl --fail --show-error --max-time 260 \
  'http://localhost:5180/api/fc/brand-assets/product-2p5d/edit' \
  -H "Authorization: Bearer ${PRODUCT_IMAGE_EDIT_TOKEN}" \
  -H 'Content-Type: image/png' \
  --data-binary @product.png \
  -o product-2p5d.png
```

文件模式支持静态 PNG、JPEG 和 WebP，Content-Type 须匹配文件，最大 12 MiB、2400 万像素。批量处理时逐张调用，每张保存为独立文件。每个服务进程同时处理一个编辑请求。

成功时响应为 `200 image/png`。失败时返回 JSON 的 `error` 字段。401 表示调用令牌有误，400/413/415/422 表示输入无效、超限或编辑被拒，429 表示繁忙或上游额度受限，502 表示上游响应失败或结果缺少有效透明度，503 表示服务配置或模型访问权限有问题，504 表示上游超时。

如需将得到的透明 PNG 再合成为品牌渐变背景和循环轻晃 WebP，可以把它传给[商品主视觉导出接口](./product-2p5d-api.md)。
