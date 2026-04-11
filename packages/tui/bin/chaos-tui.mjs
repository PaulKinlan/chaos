#!/usr/bin/env node
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register tsx loader for TypeScript + JSX support
register('tsx/esm', pathToFileURL('./'));

// Run the TUI entry point
const entry = new URL('../src/index.tsx', import.meta.url);
await import(entry.href);
