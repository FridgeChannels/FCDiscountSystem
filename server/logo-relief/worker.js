// Keep rasterization and per-pixel shading off the API server's event loop.
import { renderLogo } from './render.js';
import { InvalidLogo } from './prepare.js';

process.once('message', async ({ input, options }) => {
  try {
    const { image, style } = await renderLogo(input, options);
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
