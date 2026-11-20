# 商品主图导出接口

`POST /api/fc/brand-assets/product-2p5d` 接收一张静态商品图，直接返回可保存、可在普通图片标签中展示的文件。默认导出 640 × 800 的循环动态 WebP，将品牌渐变、底部圆角面板、商品投影、椭圆接触阴影和 7 秒轻晃合成到同一张图中。封面只包含商品场景，不包含页面的 Logo 栏、商品标题、优惠券或按钮。

## HTTP 调用

启动项目后，在项目根目录执行。返回体就是成品图片的字节。

```sh
curl --fail --show-error 'http://localhost:5180/api/fc/brand-assets/product-2p5d?primary=681cab&secondary=fbeaff' \
  -H 'Content-Type: image/webp' \
  --data-binary @public/reorder/mosh/high-protein-variety.webp \
  -o mosh-hero.webp
```

| 输入 | 说明 |
| --- | --- |
| 请求体 | 单张 PNG、静态 WebP 或 JPEG 的原始字节，Content-Type 分别为 image/png、image/webp、image/jpeg。最大 12 MiB、2400 万像素。 |
| primary / secondary | 可选的六位 RGB 主色和辅色，URL 中直接用六位字符。默认 681cab / fbeaff，与 MOSH 预览一致。 |
| format | 默认 webp。设置 png 返回相同构图的静帧，适合封面或需要减少动画的场景。 |

推荐使用已抠好的透明 PNG 或 WebP，原图中的商品、外包装和角标一起等比缩放。实底素材按原样保留底色，文字和角标也取自原图。输出是包含背景的完整主视觉，可直接替换主视觉区域；嵌入时无需再叠加原页面的渐变、投影或 CSS 摇摆。

响应为 200 和 image/webp 或 image/png。失败时返回 JSON 的 error 字段。400 表示参数或请求体无效，413 表示文件过大，415 表示不支持的文件类型，422 表示图像损坏、解码后过大、全透明或包含多个帧。服务繁忙时返回 429 和 Retry-After。

## 一批图片 → 每张一个文件

在项目根目录执行，下例处理 input-products 目录第一层的所有 PNG、WebP、JPG 和 JPEG。两个目录可替换为绝对路径。也可以把第一个目录换成单个文件路径。

```sh
node scripts/render-product-heroes.mjs ./input-products ./output-products \
  --primary 681cab --secondary fbeaff --format webp
```

例如 bar.png 输出 bar.png.2p5d.webp。保留源扩展名可以区分同名的 JPG 和 PNG。重复执行会替换对应成品。某张图出错，程序会报告文件名，并继续处理其余图片；有失败时最终退出码为 1。

## 在 Node.js 中直接使用

```js
import { readFile, writeFile } from 'node:fs/promises';
import { renderProductHero } from './server/product-hero/render.js';

const input = await readFile('product.png');
const output = await renderProductHero(input, { primary: '#681cab', secondary: '#fbeaff' });
await writeFile('product-hero.webp', output);
```
