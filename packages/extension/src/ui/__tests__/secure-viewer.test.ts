/**
 * Tests for secure-viewer content rendering functions.
 *
 * These tests verify content type detection and the exported utilities.
 * The actual iframe rendering requires a DOM environment.
 */

import { describe, it, expect } from 'vitest';
import { detectContentType } from '../secure-viewer.js';

describe('detectContentType', () => {
  it('detects HTML files', () => {
    expect(detectContentType('page.html')).toBe('html');
    expect(detectContentType('page.htm')).toBe('html');
  });

  it('detects Markdown files', () => {
    expect(detectContentType('readme.md')).toBe('markdown');
    expect(detectContentType('notes.markdown')).toBe('markdown');
  });

  it('detects JSON files', () => {
    expect(detectContentType('data.json')).toBe('json');
  });

  it('detects CSV files', () => {
    expect(detectContentType('report.csv')).toBe('csv');
  });

  it('detects SVG files', () => {
    expect(detectContentType('icon.svg')).toBe('svg');
  });

  it('detects PDF files', () => {
    expect(detectContentType('document.pdf')).toBe('pdf');
  });

  it('detects image files', () => {
    expect(detectContentType('photo.png')).toBe('image');
    expect(detectContentType('photo.jpg')).toBe('image');
    expect(detectContentType('photo.jpeg')).toBe('image');
    expect(detectContentType('photo.gif')).toBe('image');
    expect(detectContentType('photo.webp')).toBe('image');
  });

  it('defaults to text for unknown extensions', () => {
    expect(detectContentType('file.txt')).toBe('text');
    expect(detectContentType('file.log')).toBe('text');
    expect(detectContentType('file.xyz')).toBe('text');
  });

  it('handles paths with multiple dots', () => {
    expect(detectContentType('/path/to/file.data.json')).toBe('json');
    expect(detectContentType('archive.tar.gz')).toBe('text'); // .gz is unknown
  });
});
