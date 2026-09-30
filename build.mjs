import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = join(projectDirectory, 'lib')
if (dirname(outputDirectory) !== projectDirectory) throw new Error('Build output escaped the project directory')
await rm(outputDirectory, { recursive: true, force: true })
await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true,
  format: 'esm', platform: 'node', target: 'node22', sourcemap: true,
  packages: 'external',
})
await build({
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2024', sourcemap: true,
  external: [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives',
  ],
  loader: { '.css': 'text' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-quota", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
