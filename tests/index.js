'use strict';
// Entry point for `node --test tests/` (package.json "test"). Node >= 21 resolves a directory
// argument like a module path, so this index imports every *.test.mjs in this folder; node:test
// collects and reports them. `node --test` (no args) also works: it finds the *.test.mjs files
// directly and ignores this file.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort();
  for (const f of files) await import(pathToFileURL(path.join(__dirname, f)).href);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
