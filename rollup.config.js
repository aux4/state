import { fileURLToPath } from 'node:url';
export default {
  input: 'src/cli.mjs',
  output: { file: 'package/lib/state.mjs', format: 'es', inlineDynamicImports: true },
  plugins: [{ name: 'yaml-esm', resolveId(id) { if (id === 'yaml') return fileURLToPath(new URL('./node_modules/yaml/browser/index.js', import.meta.url)); } }],
  external: id => id.startsWith('node:')
};
