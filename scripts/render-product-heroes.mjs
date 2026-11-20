import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MAX_BYTES, renderProductHero } from '../server/product-hero/render.js';

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { primary: { type: 'string' }, secondary: { type: 'string' }, format: { type: 'string', default: 'webp' } },
  });
  if (positionals.length !== 2) throw new Error('Usage: node scripts/render-product-heroes.mjs INPUT_FILE_OR_DIR OUTPUT_DIR [--primary 681cab --secondary fbeaff --format webp|png]');
  const [source, out] = positionals.map(p => path.resolve(p));
  if (!['png', 'webp'].includes(values.format)) throw new Error('format must be webp or png.');
  const isDirectory = (await stat(source)).isDirectory();
  if (isDirectory && source === out) throw new Error('Choose a separate output folder.');
  const files = isDirectory
    ? (await readdir(source, { withFileTypes: true })).filter(e => e.isFile() && /\.(png|webp|jpe?g)$/i.test(e.name))
      .map(e => path.join(source, e.name)).sort()
    : [source];
  if (!files.length) throw new Error('No PNG, JPEG or WebP files in the input directory.');
  await mkdir(out, { recursive: true });
  for (const file of files) {
    const target = path.join(out, path.basename(file) + '.2p5d.' + values.format);
    const temp = target + '.' + randomUUID() + '.tmp';
    try {
      if ((await stat(file)).size > MAX_BYTES) throw new Error('Maximum upload is 12 MiB.');
      const result = await renderProductHero(await readFile(file), values);
      await writeFile(temp, result, { flag: 'wx' });
      await rename(temp, target);
      console.log(target);
    } catch (error) {
      await rm(temp, { force: true });
      console.error(file + ': ' + error.message);
      process.exitCode = 1;
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
