import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, object, safe } from './model.mjs';

export class Storage {
  constructor(dir, stateDir, environment) {
    assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(environment), 'Invalid environment name');
    this.environment = environment;
    this.folder = path.resolve(dir, stateDir);
    this.file = path.join(this.folder, `${environment}.json`);
    this.lock = `${this.file}.lock`;
  }
  async read() {
    try {
      const state = safe(JSON.parse(await fs.readFile(this.file, 'utf8')));
      assert(state.version === 1 && state.environment === this.environment && object(state.resources) && object(state.providers) && Array.isArray(state.pending), 'Invalid state file or environment mismatch');
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 1, environment: this.environment, stackId: randomUUID(), serial: 0, providers: {}, resources: {}, pending: [], operation: null };
    }
  }
  async acquire() {
    await fs.mkdir(this.folder, { recursive: true, mode: 0o700 });
    try { this.handle = await fs.open(this.lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Environment is locked: ${this.lock}. Remove only after confirming no state operation is running.`);
      throw error;
    }
    await this.handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  }
  async release() {
    if (this.handle) { await this.handle.close(); await fs.unlink(this.lock); this.handle = null; }
  }
  async write(state) {
    assert(this.handle, 'State writes require a lock');
    state.serial++;
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const handle = await fs.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(tmp, this.file);
  }
}
