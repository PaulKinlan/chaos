/**
 * E2E Tests: Extension Loads
 *
 * Smoke tests to verify the extension loads correctly:
 * - Service worker is active
 * - Side panel page is accessible
 * - Dashboard page is accessible
 * - Popup is accessible
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  launchWithExtension,
  extensionUrl,
  isChromeAvailable,
  type ExtensionContext,
} from './setup.js';

const SKIP = !isChromeAvailable();

describe.skipIf(SKIP)('Extension loads', () => {
  let ctx: ExtensionContext;

  beforeAll(async () => {
    ctx = await launchWithExtension();
  }, 30000);

  afterAll(async () => {
    if (ctx?.browser) {
      await ctx.browser.close();
    }
  });

  it('should have a valid extension ID', () => {
    expect(ctx.extensionId).toBeTruthy();
    expect(ctx.extensionId.length).toBeGreaterThan(0);
  });

  it('should have an active service worker', () => {
    const targets = ctx.browser.targets();
    const swTarget = targets.find(
      (t) =>
        t.type() === 'service_worker' &&
        t.url().includes(ctx.extensionId),
    );
    expect(swTarget).toBeDefined();
  });

  it('should load the side panel page', async () => {
    const page = await ctx.browser.newPage();
    try {
      const url = extensionUrl(ctx.extensionId, 'sidepanel.html');
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);

      // Check that the page has expected content
      const title = await page.title();
      expect(title).toBeTruthy();
    } finally {
      await page.close();
    }
  }, 15000);

  it('should load the dashboard page', async () => {
    const page = await ctx.browser.newPage();
    try {
      const url = extensionUrl(ctx.extensionId, 'app.html');
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);

      const title = await page.title();
      expect(title).toBeTruthy();
    } finally {
      await page.close();
    }
  }, 15000);

  it('should load the popup page', async () => {
    const page = await ctx.browser.newPage();
    try {
      const url = extensionUrl(ctx.extensionId, 'popup.html');
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);
    } finally {
      await page.close();
    }
  }, 15000);
});
