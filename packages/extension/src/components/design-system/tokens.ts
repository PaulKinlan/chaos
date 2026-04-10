/**
 * Design tokens for the CHAOS design system.
 *
 * These are string constants that reference existing CSS custom properties
 * defined in app.html. They serve as documentation and provide a single
 * source of truth for which CSS variables are available.
 *
 * Usage: import { tokens } from './tokens.js';
 *        style="color: ${tokens.textPrimary}"
 */
export const tokens = {
  // ── Backgrounds ──
  /** Page background — darkest layer */
  bgBase: 'var(--bg-base)',
  /** Slightly raised background (sidebar, top bar) */
  bgRaised: 'var(--bg-raised)',
  /** Card/panel surface background */
  bgSurface: 'var(--bg-surface)',
  /** Hover state background */
  bgHover: 'var(--bg-hover)',
  /** Tertiary background (between base and raised) */
  bgTertiary: 'var(--bg-tertiary)',
  /** Inset/recessed background */
  bgInset: 'var(--bg-inset)',

  // ── Text ──
  /** Primary text — headings, body */
  textPrimary: 'var(--text-primary)',
  /** Secondary text — descriptions, labels */
  textSecondary: 'var(--text-secondary)',
  /** Muted text — hints, timestamps */
  textMuted: 'var(--text-muted)',
  /** Text on accent-colored backgrounds */
  textOnAccent: 'var(--text-on-accent)',
  /** Text on danger-colored backgrounds */
  textOnDanger: 'var(--text-on-danger)',

  // ── Accent ──
  /** Primary accent color */
  accent: 'var(--accent)',
  /** Accent hover state */
  accentHover: 'var(--accent-hover)',
  /** Subtle accent background */
  accentSubtle: 'var(--accent-subtle)',
  /** Accent-colored text */
  accentText: 'var(--accent-text)',
  /** Accent border */
  accentBorder: 'var(--accent-border)',

  // ── Semantic: Success ──
  success: 'var(--success)',
  successSubtle: 'var(--success-subtle)',
  successText: 'var(--success-text)',

  // ── Semantic: Danger ──
  danger: 'var(--danger)',
  dangerSubtle: 'var(--danger-subtle)',
  dangerText: 'var(--danger-text)',
  dangerHover: 'var(--danger-hover)',
  dangerBorder: 'var(--danger-border)',

  // ── Semantic: Warning ──
  warningSubtle: 'var(--warning-subtle)',
  warningText: 'var(--warning-text)',

  // ── Semantic: Info ──
  infoSubtle: 'var(--info-subtle)',
  infoText: 'var(--info-text)',

  // ── Borders ──
  /** Subtle border — between same-level surfaces */
  borderSubtle: 'var(--border-subtle)',
  /** Default border — cards, inputs */
  borderDefault: 'var(--border-default)',
  /** Focus ring border */
  borderFocus: 'var(--border-focus)',

  // ── Spacing ──
  /** 4px */
  sp1: 'var(--sp-1)',
  /** 8px */
  sp2: 'var(--sp-2)',
  /** 12px */
  sp3: 'var(--sp-3)',
  /** 16px */
  sp4: 'var(--sp-4)',
  /** 20px */
  sp5: 'var(--sp-5)',
  /** 24px */
  sp6: 'var(--sp-6)',
  /** 32px */
  sp8: 'var(--sp-8)',
  /** 48px */
  sp12: 'var(--sp-12)',

  // ── Typography ──
  /** Font family: sans-serif */
  fontSans: 'var(--font-sans)',
  /** Font family: monospace */
  fontMono: 'var(--font-mono)',
  /** 0.6875rem (~11px) */
  textXs: 'var(--text-xs)',
  /** 0.8125rem (~13px) */
  textSm: 'var(--text-sm)',
  /** 0.875rem (~14px) */
  textBase: 'var(--text-base)',
  /** 1rem (~16px) */
  textMd: 'var(--text-md)',
  /** 1.25rem (~20px) */
  textLg: 'var(--text-lg)',

  // ── Transitions ──
  easeOut: 'var(--ease-out)',
  durationFast: 'var(--duration-fast)',
  durationNormal: 'var(--duration-normal)',

  // ── Layout ──
  sidebarWidth: 'var(--sidebar-width)',
  sidebarCollapsed: 'var(--sidebar-collapsed)',
  agentTabsHeight: 'var(--agent-tabs-height)',

  // ── Overlay / Shadow ──
  overlayBg: 'var(--overlay-bg)',
  shadowColor: 'var(--shadow-color)',
  shadowColorLg: 'var(--shadow-color-lg)',

  // ── Border Radii (not CSS vars — fixed values) ──
  radiusSm: '6px',
  radiusMd: '8px',
  radiusLg: '12px',
} as const;
