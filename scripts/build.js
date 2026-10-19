#!/usr/bin/env node
// Bundles src/ into one self-contained HTML file (fonts, styles and scripts inlined).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);
const font = (file, family, style, weight) => {
  const b64 = fs.readFileSync(src('fonts/' + file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
};

const fonts = [
  font('InstrumentSerif.woff2', 'Instrument Serif', 'normal', 400),
  font('InstrumentSerif-Italic.woff2', 'Instrument Serif', 'italic', 400),
  font('InstrumentSans.woff2', 'Instrument Sans', 'normal', '400 700'),
].join('\n');
const css = fs.readFileSync(src('styles.css'), 'utf8');
const js = ['parse.js', 'analyze.js', 'gazetteer.js', 'geo.js', 'basemap.js', 'sample.js', 'viz.js', 'app.js']
  .map(f => `/* ${f} */\n` + fs.readFileSync(src('js/' + f), 'utf8')).join('\n');

const html = fs.readFileSync(src('index.html'), 'utf8')
  .replace('<!-- inject:css -->', () => `<style>\n${fonts}\n${css}</style>`)
  .replace('<!-- inject:js -->', () => `<script>\n${js}</script>`);

const out = path.join(root, 'docs', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
