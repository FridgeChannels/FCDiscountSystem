import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
function resolveFcRoot() {
  if (process.env.FC_PLATFORM_ROOT) {
    return path.resolve(process.env.FC_PLATFORM_ROOT);
  }

  // 优先同级目录,再尝试常见的用户目录布局(例如 Downloads/fc-platform)。
  const candidates = [
    path.resolve(root, '../fc-platform'),
    path.resolve(root, '../../fc-platform'),
    path.resolve(root, '../../Downloads/fc-platform'),
  ];

  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'packages/game-runtime/src')),
  );

  if (found) return found;

  throw new Error(
    'Cannot locate fc-platform. Set FC_PLATFORM_ROOT=/absolute/path/to/fc-platform',
  );
}

const fcRoot = resolveFcRoot();
const fcPackages = path.join(fcRoot, 'packages');

export default defineConfig({
  plugins: [
    react({
      // fc-platform 源码通过 alias 引入,需纳入 React Fast Refresh 处理范围
      include: [
        /\/src\/.*\.[jt]sx?$/,
        /fc-platform\/packages\/.*\.[jt]sx?$/,
      ],
    }),
  ],
  resolve: {
    alias: {
      '@fc/shared-types': path.join(fcPackages, 'shared-types/src'),
      '@fc/game-runtime': path.join(fcPackages, 'game-runtime/src'),
      '@fc/game-templates': path.join(fcPackages, 'game-templates/src'),
      '@fc/game-templates/register-runtimes': path.join(
        fcPackages,
        'game-templates/src/register-runtimes.ts',
      ),
    },
    // 与 fc-platform/apps/web next.config.mjs 对齐:TS 源码用 .js 扩展名导入
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      allow: [root, fcRoot],
    },
    proxy: {
      '/api/fc': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
