// Production build: bundles the game and the parts of three.js it uses into one minified file.
// Output goes to dist/, which is what to upload (e.g. zip it for CrazyGames). 'three' comes from
// node_modules here (npm install), since tree-shaking works best on the unminified module.
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });

const result = await build({
  entryPoints: ['js/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/game.js',
  metafile: true,
});

// Same page, minus the import map, pointing at the bundle.
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('./js/main.js', './game.js');
fs.writeFileSync('dist/index.html', html);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const size = fs.statSync('dist/game.js').size;
console.log(`dist/game.js     ${kb(size)}`);
console.log(`dist/index.html  ${kb(Buffer.byteLength(html))}`);
console.log(`inputs bundled:  ${Object.keys(result.metafile.inputs).length}`);
