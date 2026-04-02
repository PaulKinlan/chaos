/**
 * E2E Test Setup
 *
 * Helper to launch Chrome with the CHAOS extension loaded.
 * Uses Puppeteer to control the browser.
 */

import puppeteer, { type Browser } from 'puppeteer';
import path from 'path';
import { execSync } from 'child_process';

const EXTENSION_PATH = path.resolve(__dirname, '../../../dist');

/**
 * Check if a Chrome/Chromium binary is available.
 */
export function isChromeAvailable(): boolean {
  try {
    // Puppeteer's default Chrome or system Chrome
    const browserPath = puppeteer.executablePath();
    if (browserPath) return true;
  } catch {
    // Fall through
  }

  try {
    execSync('which google-chrome || which chromium || which chromium-browser', {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export interface ExtensionContext {
  browser: Browser;
  extensionId: string;
}

/**
 * Launch Chrome with the built extension loaded.
 * Returns the browser instance and the extension ID.
 */
export async function launchWithExtension(): Promise<ExtensionContext> {
  const browser = await puppeteer.launch({
    headless: 'new' as never,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // Find the extension ID by looking at the service worker target
  const extensionId = await getExtensionId(browser);

  return { browser, extensionId };
}

/**
 * Extract the extension ID from the browser's service worker targets.
 */
async function getExtensionId(browser: Browser): Promise<string> {
  // Wait a moment for the extension to register its service worker
  await new Promise((r) => setTimeout(r, 1000));

  const targets = browser.targets();
  const extensionTarget = targets.find(
    (target) =>
      target.type() === 'service_worker' &&
      target.url().startsWith('chrome-extension://'),
  );

  if (!extensionTarget) {
    // Try waiting a bit longer
    await new Promise((r) => setTimeout(r, 2000));
    const retryTargets = browser.targets();
    const retryTarget = retryTargets.find(
      (target) =>
        target.type() === 'service_worker' &&
        target.url().startsWith('chrome-extension://'),
    );
    if (!retryTarget) {
      throw new Error(
        'Could not find extension service worker. Is the extension built? (run npm run build)',
      );
    }
    const match = retryTarget.url().match(/chrome-extension:\/\/([^/]+)/);
    return match![1];
  }

  const match = extensionTarget.url().match(/chrome-extension:\/\/([^/]+)/);
  return match![1];
}

/**
 * Build the extension URL for a given page.
 */
export function extensionUrl(extensionId: string, page: string): string {
  return `chrome-extension://${extensionId}/${page}`;
}
