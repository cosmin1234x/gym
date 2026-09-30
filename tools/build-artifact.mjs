#!/usr/bin/env node
// Builds dist/forge.html: the whole app inlined into one HTML page body, the shape the
// claude.ai Artifact host expects (it wraps the page in its own doctype/head/body skeleton).
//
//   node tools/build-artifact.mjs            -> dist/forge.html
//   node tools/build-artifact.mjs out.html   -> custom output path

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(process.argv[2] || join(root, 'dist', 'forge.html'));
const html = readFileSync(join(root, 'index.html'), 'utf8');

const isLocal = (url) => url && !/^(?:[a-z]+:)?\/\//i.test(url) && !url.startsWith('data:');
const read = (rel) => readFileSync(join(root, rel.split(/[?#]/)[0]), 'utf8');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};

const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, 'FORGE'])[1].trim();

// Stylesheets: keep Google Fonts <link>s (allowed by the artifact CSP), inline local CSS.
const fontLinks = [];
const styles = [];
for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
  const tag = m[0];
  const rel = (attr(tag, 'rel') || '').toLowerCase();
  const href = attr(tag, 'href');
  if (rel === 'stylesheet' && isLocal(href)) styles.push(`/* ${href} */\n${read(href)}`);
  else if (/fonts\.(googleapis|gstatic)\.com/.test(href || '') && (rel === 'stylesheet' || rel === 'preconnect')) fontLinks.push(tag);
}

// Scripts in document order: local src files get inlined, inline scripts are kept as-is.
const scripts = [];
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const src = attr(`<script ${m[1]}>`, 'src');
  if (src && isLocal(src)) scripts.push(`/* ${src} */\n${read(src)}`);
  else if (!src && m[2].trim() && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1])) scripts.push(m[2]);
}

// Body markup without its scripts.
const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) throw new Error('index.html has no <body>');
const body = bodyMatch[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim();

// Keep inlined code from closing its own element early.
const safeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

const out = [
  `<title>${title}</title>`,
  ...fontLinks,
  `<style>\n${safeStyle(styles.join('\n\n'))}\n</style>`,
  body,
  ...scripts.map((js) => `<script>\n${safeScript(js)}\n</script>`),
  '',
].join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`Wrote ${outFile} (${kb} KB, ${styles.length} stylesheets, ${scripts.length} scripts)`);
