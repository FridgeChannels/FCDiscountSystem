// Keep rasterization and per-pixel shading off the API server's event loop.
import { renderRelief } from './render.js';
import { InvalidLogo, prepareLogo } from './prepare.js';

process.once('message', async ({ input, options }) => {
  try {
    const prepared = await prepareLogo(input, options);
    if (prepared.style === 'illustration') {
      // Decode SVGs, remove exterior matte and classify off the API event loop.
      // The parent handles authentication, cancellation and the slower AI edit.
      const image = await prepared.face.png().toBuffer();
      process.send({ type: 'illustration', image, style: 'illustration' });
      return;
    }
    const { image, style } = await renderRelief(prepared, options);
    process.send({ type: 'rendered', image, style });
  } catch (error) {
    if (!(error instanceof InvalidLogo)) console.error('[logo-relief]', error);
    process.send({
      type: 'rendered',
      status: error instanceof InvalidLogo ? 422 : 500,
      error: error instanceof InvalidLogo ? error.message : 'Logo rendering failed.',
    });
  }
});
