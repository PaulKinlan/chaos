/**
 * E2E Tests: Side Panel UI
 *
 * Smoke tests to verify the side panel renders correctly:
 * - Expected UI elements are present
 * - Settings modal opens
 * - Agent creation UI works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'puppeteer';
import {
  launchWithExtension,
  extensionUrl,
  isChromeAvailable,
  type ExtensionContext,
} from './setup.js';

const SKIP = !isChromeAvailable();

describe.skipIf(SKIP)('Side Panel UI', () => {
  let ctx: ExtensionContext;
  let page: Page;

  beforeAll(async () => {
    ctx = await launchWithExtension();
    page = await ctx.browser.newPage();
    const url = extensionUrl(ctx.extensionId, 'sidepanel.html');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Wait for scripts to initialize
    await new Promise((r) => setTimeout(r, 500));
  }, 30000);

  afterAll(async () => {
    if (page) await page.close();
    if (ctx?.browser) await ctx.browser.close();
  });

  it('should render the agent selector', async () => {
    const agentSelect = await page.$('#agent-select');
    expect(agentSelect).not.toBeNull();
  });

  it('should render the message input', async () => {
    const chatInput = await page.$('#chat-input');
    expect(chatInput).not.toBeNull();
  });

  it('should render the send button', async () => {
    const btnSend = await page.$('#btn-send');
    expect(btnSend).not.toBeNull();
  });

  it('should render the settings button', async () => {
    const btnSettings = await page.$('#btn-settings');
    expect(btnSettings).not.toBeNull();
  });

  it('should render the new agent button', async () => {
    const btnNewAgent = await page.$('#btn-new-agent');
    expect(btnNewAgent).not.toBeNull();
  });

  it('should open the settings modal when settings is clicked', async () => {
    // Click the settings button
    await page.click('#btn-settings');
    await new Promise((r) => setTimeout(r, 300));

    // Check that the modal is visible
    const isVisible = await page.$eval('#settings-modal', (el) =>
      el.classList.contains('visible'),
    );
    expect(isVisible).toBe(true);

    // Check that API key inputs are present
    const anthropicInput = await page.$('#key-anthropic');
    const googleInput = await page.$('#key-google');
    const openaiInput = await page.$('#key-openai');
    const openrouterInput = await page.$('#key-openrouter');

    expect(anthropicInput).not.toBeNull();
    expect(googleInput).not.toBeNull();
    expect(openaiInput).not.toBeNull();
    expect(openrouterInput).not.toBeNull();

    // Close the modal
    await page.click('#btn-settings-cancel');
    await new Promise((r) => setTimeout(r, 300));

    const isHidden = await page.$eval('#settings-modal', (el) =>
      !el.classList.contains('visible'),
    );
    expect(isHidden).toBe(true);
  });

  it('should open the create agent modal', async () => {
    await page.click('#btn-new-agent');
    await new Promise((r) => setTimeout(r, 300));

    const isVisible = await page.$eval('#create-agent-modal', (el) =>
      el.classList.contains('visible'),
    );
    expect(isVisible).toBe(true);

    // Check the name input and role select
    const nameInput = await page.$('#agent-name');
    const roleSelect = await page.$('#agent-role');
    expect(nameInput).not.toBeNull();
    expect(roleSelect).not.toBeNull();

    // Close the modal
    await page.click('#btn-create-cancel');
    await new Promise((r) => setTimeout(r, 300));
  });

  it('should show setup prompt when no API keys are configured', async () => {
    // The setup prompt should be visible since we have no keys configured
    const setupPrompt = await page.$('#setup-prompt');
    expect(setupPrompt).not.toBeNull();
  });
});
