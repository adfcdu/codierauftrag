import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Version source: package.json by default (dev builds). Release builds inject
// the git tag via APP_VERSION (08 § CI/CD: ci.yml release job passes
// --build-arg APP_VERSION=<tag without v> → Dockerfile exports it here) — the
// released image's PDF footer always shows the tag it was built from.
const version = process.env.APP_VERSION || pkg.version;

export default defineConfig({
  root: 'client',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
