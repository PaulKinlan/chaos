#!/usr/bin/env node
/**
 * Validate the Chrome extension build output.
 * Checks that all file references in manifest.json, HTML files,
 * and the service worker loader actually resolve to existing files.
 *
 * Run after `vite build` to catch broken references.
 */

import fs from 'fs';
import path from 'path';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
let errors = 0;

function check(file, context) {
  const resolved = path.join(DIST, file);
  if (!fs.existsSync(resolved)) {
    console.error(`✗ ${context}: ${file} — MISSING`);
    errors++;
  } else {
    console.log(`✓ ${context}: ${file}`);
  }
}

// 1. Check dist/ exists
if (!fs.existsSync(DIST)) {
  console.error('✗ dist/ directory does not exist. Run `vite build` first.');
  process.exit(1);
}

// 2. Check manifest.json
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));

// Background service worker
check(manifest.background.service_worker, 'manifest.background.service_worker');

// Web accessible resources
for (const group of manifest.web_accessible_resources || []) {
  for (const resource of group.resources || []) {
    check(resource, 'manifest.web_accessible_resources');
  }
}

// Content scripts
for (const cs of manifest.content_scripts || []) {
  for (const jsFile of cs.js || []) {
    check(jsFile, 'manifest.content_scripts.js');
  }
  for (const cssFile of cs.css || []) {
    check(cssFile, 'manifest.content_scripts.css');
  }
}

// 3. Check service worker loader imports
const loaderPath = path.join(DIST, manifest.background.service_worker);
if (fs.existsSync(loaderPath)) {
  const loader = fs.readFileSync(loaderPath, 'utf8');
  const importMatch = loader.match(/import\s+['"]([^'"]+)['"]/g);
  if (importMatch) {
    for (const m of importMatch) {
      const ref = m.match(/['"]([^'"]+)['"]/)[1];
      const resolved = ref.startsWith('./') ? ref.slice(2) : ref;
      check(resolved, 'service-worker import');
    }
  }
}

// 4. Check HTML files for script/link references
const htmlFiles = [];
function findHtml(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtml(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
findHtml(DIST);

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const relContext = path.relative(DIST, htmlFile);

  // Script src references
  const scriptMatches = html.matchAll(/src=["']([^"']+\.(?:js|mjs))["']/g);
  for (const m of scriptMatches) {
    const ref = m[1];
    // Absolute paths (starting with /) are relative to extension root
    const resolved = ref.startsWith('/') ? ref.slice(1) : path.relative(DIST, path.resolve(path.dirname(htmlFile), ref));
    check(resolved, `${relContext} <script src>`);
  }

  // Link href references (CSS, modulepreload)
  const linkMatches = html.matchAll(/href=["']([^"']+\.(?:css|js|mjs))["']/g);
  for (const m of linkMatches) {
    const ref = m[1];
    const resolved = ref.startsWith('/') ? ref.slice(1) : path.relative(DIST, path.resolve(path.dirname(htmlFile), ref));
    check(resolved, `${relContext} <link href>`);
  }
}

// 5. Summary
console.log('');
if (errors > 0) {
  console.error(`BUILD VALIDATION FAILED: ${errors} broken reference(s)`);
  process.exit(1);
} else {
  console.log('BUILD VALIDATION PASSED: all references resolve');
}
