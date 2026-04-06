// Global constants injected by Vite at build time
declare const __CHAOS_DEFAULT_RELAY_URL__: string;

// Vite raw imports for markdown files
declare module '*.md?raw' {
  const content: string;
  export default content;
}
