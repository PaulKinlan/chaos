/**
 * Example 8: Custom MemoryStore Implementations
 *
 * The MemoryStore interface is simple — implement it to back agent
 * memory with any storage system. Here are patterns for common backends.
 *
 * This file shows PATTERNS only — it doesn't import actual cloud SDKs.
 * Copy the pattern and add the real SDK calls for your backend.
 */

import type { MemoryStore, FileEntry } from '@chaos/agent-loop';

// ═══════════════════════════════════════════════════
// Pattern 1: Node.js Filesystem
// ═══════════════════════════════════════════════════

/*
import * as fs from 'node:fs';
import * as path from 'node:path';

class FilesystemMemoryStore implements MemoryStore {
  constructor(private baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private resolve(agentId: string, filePath: string): string {
    const full = path.resolve(this.baseDir, agentId, filePath);
    if (!full.startsWith(path.resolve(this.baseDir))) throw new Error('Path traversal');
    return full;
  }

  async read(agentId: string, p: string): Promise<string> {
    return fs.readFileSync(this.resolve(agentId, p), 'utf-8');
  }

  async write(agentId: string, p: string, content: string): Promise<void> {
    const full = this.resolve(agentId, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }

  async append(agentId: string, p: string, content: string): Promise<void> {
    const full = this.resolve(agentId, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, content, 'utf-8');
  }

  async delete(agentId: string, p: string): Promise<void> {
    const full = this.resolve(agentId, p);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  async list(agentId: string, p?: string): Promise<FileEntry[]> {
    const full = this.resolve(agentId, p || '.');
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' as const : 'file' as const,
    }));
  }

  async mkdir(agentId: string, p: string): Promise<void> {
    fs.mkdirSync(this.resolve(agentId, p), { recursive: true });
  }

  async exists(agentId: string, p: string): Promise<boolean> {
    return fs.existsSync(this.resolve(agentId, p));
  }

  async search(agentId: string, pattern: string, p?: string): Promise<Array<{ path: string; line: string }>> {
    // Use grep or walk the directory tree
    return [];
  }
}
*/

// ═══════════════════════════════════════════════════
// Pattern 2: AWS S3
// ═══════════════════════════════════════════════════

/*
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

class S3MemoryStore implements MemoryStore {
  private client: S3Client;
  constructor(private bucket: string, region = 'us-east-1') {
    this.client = new S3Client({ region });
  }

  private key(agentId: string, path: string): string {
    return `agents/${agentId}/${path}`;
  }

  async read(agentId: string, path: string): Promise<string> {
    const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(agentId, path) }));
    return await resp.Body!.transformToString();
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(agentId, path), Body: content }));
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    let existing = '';
    try { existing = await this.read(agentId, path); } catch { }
    await this.write(agentId, path, existing + content);
  }

  async delete(agentId: string, path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(agentId, path) }));
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const prefix = this.key(agentId, path || '') + '/';
    const resp = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, Delimiter: '/' }));
    const entries: FileEntry[] = [];
    for (const p of resp.CommonPrefixes || []) entries.push({ name: p.Prefix!.split('/').filter(Boolean).pop()!, type: 'directory' });
    for (const o of resp.Contents || []) entries.push({ name: o.Key!.split('/').pop()!, type: 'file' });
    return entries;
  }

  async mkdir(): Promise<void> { } // S3 doesn't need explicit directories
  async exists(agentId: string, path: string): Promise<boolean> {
    try { await this.read(agentId, path); return true; } catch { return false; }
  }
  async search(): Promise<Array<{ path: string; line: string }>> { return []; }
}
*/

// ═══════════════════════════════════════════════════
// Pattern 3: Google Firestore
// ═══════════════════════════════════════════════════

/*
import { Firestore } from '@google-cloud/firestore';

class FirestoreMemoryStore implements MemoryStore {
  private db: Firestore;
  constructor(projectId: string) {
    this.db = new Firestore({ projectId });
  }

  private docRef(agentId: string, path: string) {
    return this.db.collection('agent-memory').doc(`${agentId}:${path.replace(/\//g, ':')}`);
  }

  async read(agentId: string, path: string): Promise<string> {
    const doc = await this.docRef(agentId, path).get();
    if (!doc.exists) throw new Error(`File not found: ${path}`);
    return doc.data()!.content;
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    await this.docRef(agentId, path).set({ content, type: 'file', updatedAt: new Date().toISOString() });
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    const existing = await this.read(agentId, path).catch(() => '');
    await this.write(agentId, path, existing + content);
  }

  async delete(agentId: string, path: string): Promise<void> {
    await this.docRef(agentId, path).delete();
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const prefix = path ? `${agentId}:${path.replace(/\//g, ':')}:` : `${agentId}:`;
    const snap = await this.db.collection('agent-memory').where('__name__', '>=', prefix).where('__name__', '<', prefix + '\uf8ff').get();
    return snap.docs.map(d => ({ name: d.id.split(':').pop()!, type: (d.data().type || 'file') as 'file' | 'directory' }));
  }

  async mkdir(): Promise<void> { }
  async exists(agentId: string, path: string): Promise<boolean> {
    return (await this.docRef(agentId, path).get()).exists;
  }
  async search(): Promise<Array<{ path: string; line: string }>> { return []; }
}
*/

// ═══════════════════════════════════════════════════
// Pattern 4: SQLite (via better-sqlite3)
// ═══════════════════════════════════════════════════

/*
import Database from 'better-sqlite3';

class SQLiteMemoryStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS files (
      agent_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'file',
      PRIMARY KEY (agent_id, path)
    )`);
  }

  async read(agentId: string, path: string): Promise<string> {
    const row = this.db.prepare('SELECT content FROM files WHERE agent_id = ? AND path = ?').get(agentId, path) as any;
    if (!row) throw new Error(`File not found: ${path}`);
    return row.content;
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO files (agent_id, path, content, type) VALUES (?, ?, ?, ?)').run(agentId, path, content, 'file');
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    const existing = await this.read(agentId, path).catch(() => '');
    await this.write(agentId, path, existing + content);
  }

  async delete(agentId: string, path: string): Promise<void> {
    this.db.prepare('DELETE FROM files WHERE agent_id = ? AND path = ?').run(agentId, path);
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const prefix = path ? path + '/' : '';
    const rows = this.db.prepare('SELECT path, type FROM files WHERE agent_id = ? AND path LIKE ?').all(agentId, prefix + '%') as any[];
    return rows.map(r => ({ name: r.path.replace(prefix, '').split('/')[0], type: r.type }));
  }

  async mkdir(): Promise<void> { }
  async exists(agentId: string, path: string): Promise<boolean> {
    return !!this.db.prepare('SELECT 1 FROM files WHERE agent_id = ? AND path = ?').get(agentId, path);
  }
  async search(agentId: string, pattern: string): Promise<Array<{ path: string; line: string }>> {
    const rows = this.db.prepare('SELECT path, content FROM files WHERE agent_id = ? AND content LIKE ?').all(agentId, `%${pattern}%`) as any[];
    return rows.flatMap(r => r.content.split('\n').filter((l: string) => l.includes(pattern)).map((line: string) => ({ path: r.path, line })));
  }
}
*/

console.log('═══════════════════════════════════════════════');
console.log('  Example 8: Custom MemoryStore Patterns');
console.log('═══════════════════════════════════════════════\n');

console.log('This file contains MemoryStore implementation patterns.');
console.log('Each pattern implements the same MemoryStore interface');
console.log('backed by a different storage system.\n');

console.log('To use one: uncomment the class and add the SDK dependency.\n');

console.log('Available patterns:');
console.log('  1. Node.js Filesystem  — uses fs module, stores files on disk');
console.log('  2. AWS S3              — uses @aws-sdk/client-s3, stores in a bucket');
console.log('  3. Google Firestore    — uses @google-cloud/firestore, stores as documents');
console.log('  4. SQLite              — uses better-sqlite3, stores in a local database\n');

console.log('All patterns implement: read, write, append, delete, list, mkdir, exists, search');
console.log('');
console.log('Done — this is a reference file, no code was executed.');
