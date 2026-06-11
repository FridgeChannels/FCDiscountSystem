import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
// FC platform 源码路径可通过环境变量 FC_PLATFORM_ROOT 覆盖,
// 默认回退到仓库同级的 ../fc-platform,
// 避免把构建绑死在某台机器的本地绝对路径上。
const fcRoot = process.env.FC_PLATFORM_ROOT
  ? path.resolve(process.env.FC_PLATFORM_ROOT)
  : path.resolve(root, '../fc-platform');
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
