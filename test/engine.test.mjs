import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { Storage } from '../src/storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const provider = path.join(root, 'test/mock-provider.mjs');
async function fixture(t, config = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aux4-state-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = path.join(dir, 'remote.json');
  const providers = { mock: { command: [process.execPath, provider], config: { store, ...config } } };
  async function definitions(resources, filename = 'main.state.yaml') {
    await fs.writeFile(path.join(dir, filename), stringify({ version: 1, providers, resources }));
  }
  function run(action, { environment = 'dev', args = [], fail = false } = {}) {
    const result = spawnSync('aux4', ['state', action, '--dir', dir, '--environment', environment, '--format', 'json', ...(['apply', 'destroy'].includes(action) ? ['--yes', 'true'] : []), ...args], { cwd: path.join(root, 'package'), encoding: 'utf8', timeout: 20000 });
    if (fail) { assert.notEqual(result.status, 0, result.stdout); return result.stderr; }
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  }
  return { dir, store, providers, definitions, run, remote: async () => JSON.parse(await fs.readFile(store, 'utf8')) };
}
const thing = (name, extra = {}) => ({ type: 'mock/thing', properties: { name, ...extra } });

test('create, no-op, nested drift, arrays, immutable replacement and reverse destruction', async t => {
  const f = await fixture(t);
  await f.definitions({ parent: thing('Parent', { metadata: { team: { name: 'billing' } }, items: [{ name: 'first' }] }), child: thing('Child', { parent: '${resources.parent.id}' }) });
  const plan = f.run('plan');
  assert.equal(plan.counts.create, 2);
  await assert.rejects(fs.access(path.join(f.dir, '.aux4-state')));
  f.run('apply');
  let remote = await f.remote();
  assert.deepEqual(remote.calls.map(x => x.resource), ['parent', 'child']);
  assert.equal(remote.resources.mock_2.parent, 'mock_1');
  assert.equal(f.run('plan').counts.noop, 2);
  remote.resources.mock_1.metadata.team.name = 'drift';
  remote.resources.mock_1.items.push('external');
  await fs.writeFile(f.store, JSON.stringify(remote));
  const drift = f.run('plan');
  assert.equal(drift.counts.update, 1);
  assert(drift.changes[0].changes.some(x => x.path === 'metadata.team.name'));
  f.run('apply');
  await f.definitions({ parent: thing('Replacement'), child: thing('Child', { parent: '${resources.parent.id}' }) });
  assert.equal(f.run('plan').counts.replace, 2);
  f.run('apply');
  remote = await f.remote();
  assert.deepEqual(remote.calls.slice(-4).map(x => [x.action, x.id]), [['create', 'mock_3'], ['create', 'mock_4'], ['delete', 'mock_2'], ['delete', 'mock_1']]);
  assert.equal(f.run('plan').counts.noop, 2);
  f.run('destroy');
  assert.deepEqual((await f.remote()).calls.slice(-2).map(x => x.id), ['mock_4', 'mock_3']);
  assert.deepEqual(f.run('inspect').resources, {});
});

test('isolates environments, rejects account changes and locks concurrent writers', async t => {
  const f = await fixture(t);
  await f.definitions({ product: thing('Pro') });
  f.run('apply', { environment: 'dev' });
  f.run('apply', { environment: 'prod' });
  const dev = f.run('inspect', { environment: 'dev' });
  const prod = f.run('inspect', { environment: 'prod' });
  assert.notEqual(dev.resources.product.id, prod.resources.product.id);
  const lock = new Storage(f.dir, '.aux4-state', 'dev');
  await lock.acquire();
  try { assert.match(f.run('apply', { fail: true }), /locked/); }
  finally { await lock.release(); }
  f.providers.mock.config.account = 'different';
  await f.definitions({ product: thing('Pro') });
  assert.match(f.run('plan', { fail: true }), /identity differs/);
  assert.match(f.run('inspect', { environment: '../prod', fail: true }), /Invalid environment/);
});

test('discovers both suffixes, checks cycles, duplicates, invalid properties and missing variables', async t => {
  const f = await fixture(t);
  await f.definitions({ a: thing('A') });
  await fs.writeFile(path.join(f.dir, 'more.state.yml'), stringify({ version: 1, resources: { b: thing('B', { parent: '${resources.a.id}' }) } }));
  assert.equal(f.run('validate').resources, 2);
  await fs.writeFile(path.join(f.dir, 'more.state.yml'), stringify({ version: 1, resources: { a: thing('A') } }));
  assert.match(f.run('validate', { fail: true }), /Duplicate resource/);
  await fs.unlink(path.join(f.dir, 'more.state.yml'));
  await f.definitions({ a: thing('A', { parent: '${resources.b.id}' }), b: thing('B', { parent: '${resources.a.id}' }) });
  assert.match(f.run('validate', { fail: true }), /cycle/);
  await f.definitions({ a: thing('${var.missing}') });
  assert.match(f.run('validate', { fail: true }), /Unresolved reference/);
  await f.definitions({ a: thing('A', { wrong: true }) });
  assert.match(f.run('validate', { fail: true }), /unsupported property/);
  await fs.writeFile(path.join(f.dir, 'main.state.yaml'), 'version: 1\nresources:\n  a: {}\n  a: {}\n');
  assert.match(f.run('validate', { fail: true }), /unique|Duplicate/i);
});

test('config variables bind through aux4/config and references retain typed arrays and objects', async t => {
  const f = await fixture(t);
  await f.definitions({ product: thing('${var.name}', { parent: 'env-${var.details.stage}', items: '${var.items}', metadata: '${var.metadata}' }) });
  const config = path.join(f.dir, 'config.yaml');
  await fs.writeFile(config, stringify({ config: { staging: { environment: 'staging', variables: { name: 'Staging Pro', details: { stage: 'staging' }, items: [{ name: 'Feature' }], metadata: { flags: [true, false], amount: 500 } } } } }));
  const result = f.run('apply', { environment: 'staging', args: ['--configFile', config, '--config', 'staging'] });
  assert.equal(result.counts.create, 1);
  assert.deepEqual((await f.remote()).resources.mock_1.items, [{ name: 'Feature' }]);
  assert.equal((await f.remote()).resources.mock_1.parent, 'env-staging');
  assert.equal((await f.remote()).resources.mock_1.metadata.amount, 500);
});

test('imports existing resources, detects deletion and protects resources from removal', async t => {
  const f = await fixture(t);
  await f.definitions({ product: thing('Pro') });
  await fs.writeFile(f.store, JSON.stringify({ next: 1, resources: { mock_1: { name: 'Pro', parent: '', metadata: {}, items: [] } }, calls: [], keys: {} }));
  f.run('import', { args: ['--resource', 'product', '--id', 'mock_1'] });
  assert.equal((await f.remote()).calls.length, 0);
  assert.equal(f.run('plan').counts.noop, 1);
  await f.definitions({ product: { ...thing('Pro'), lifecycle: { preventDestroy: true } } });
  f.run('apply');
  await f.definitions({});
  assert.match(f.run('plan', { fail: true }), /preventDestroy/);
  assert.match(f.run('destroy', { fail: true }), /preventDestroy/);
});

test('journals a lost create response and reuses the idempotency key after restarting', async t => {
  const f = await fixture(t);
  f.providers.mock.config.failAfterCreate = path.join(f.dir, 'failed-once');
  await f.definitions({ product: thing('Pro') });
  assert.match(f.run('apply', { fail: true }), /lost create response/);
  assert.equal(f.run('inspect').operation.action, 'create');
  await f.definitions({ product: thing('Different') });
  assert.match(f.run('apply', { fail: true }), /Restore the previous/);
  await f.definitions({ product: thing('Pro') });
  f.run('apply');
  assert.equal((await f.remote()).calls.length, 1);
  assert.equal(f.run('inspect').operation, null);
  assert.equal(f.run('plan').counts.noop, 1);
});

test('missing remote objects are recreated and removed definitions are destroyed', async t => {
  const f = await fixture(t);
  await f.definitions({ a: thing('A'), b: thing('B') });
  f.run('apply');
  const remote = await f.remote();
  delete remote.resources.mock_1;
  await fs.writeFile(f.store, JSON.stringify(remote));
  assert.equal(f.run('plan').counts.create, 1);
  f.run('apply');
  await f.definitions({ a: thing('A') });
  assert.equal(f.run('plan').counts.destroy, 1);
  f.run('apply');
  assert.equal(Object.keys((await f.remote()).resources).length, 1);
});

test('retirement follows previous dependencies when the desired graph reverses', async t => {
  const f = await fixture(t);
  await f.definitions({ a: thing('A', { parent: '${resources.b.id}' }), b: thing('B') });
  f.run('apply');
  const old = f.run('inspect').resources;
  await f.definitions({ a: thing('A'), b: thing('B', { parent: '${resources.a.id}' }) });
  f.run('apply');
  assert.deepEqual((await f.remote()).calls.slice(-2).map(x => x.id), [old.a.id, old.b.id]);
});

test('retirement orders replaced dependents before removed dependencies', async t => {
  const f = await fixture(t);
  await f.definitions({ product: thing('Product'), price: thing('Price', { parent: '${resources.product.id}' }) });
  f.run('apply');
  const old = f.run('inspect').resources;
  await f.definitions({ price: thing('Price', { parent: 'external_product' }) });
  f.run('apply');
  assert.deepEqual((await f.remote()).calls.slice(-2).map(x => x.id), [old.price.id, old.product.id]);
});

test('lost update and deletion responses recover without repeating effects', async t => {
  const f = await fixture(t);
  await f.definitions({ a: thing('A') });
  f.run('apply');
  f.providers.mock.config.failOnce = path.join(f.dir, 'failed-update');
  f.providers.mock.config.failAction = 'update';
  await f.definitions({ a: thing('A', { metadata: { changed: true } }) });
  assert.match(f.run('apply', { fail: true }), /lost update response/);
  f.run('apply');
  assert.equal((await f.remote()).calls.filter(x => x.action === 'update').length, 1);
  f.providers.mock.config.failOnce = path.join(f.dir, 'failed-delete');
  f.providers.mock.config.failAction = 'delete';
  await f.definitions({});
  assert.match(f.run('apply', { fail: true }), /lost delete response/);
  f.run('apply');
  assert.equal((await f.remote()).calls.filter(x => x.action === 'delete').length, 1);
  assert.deepEqual(f.run('inspect').resources, {});
});

test('expired interrupted creates stop before replaying a possibly expired idempotency key', async t => {
  const f = await fixture(t);
  f.providers.mock.config.failAfterCreate = path.join(f.dir, 'failed-once');
  await f.definitions({ a: thing('A') });
  f.run('apply', { fail: true });
  const file = path.join(f.dir, '.aux4-state/dev.json');
  const saved = f.run('inspect');
  saved.operation.startedAt = '2000-01-01T00:00:00.000Z';
  await fs.writeFile(file, JSON.stringify(saved));
  assert.match(f.run('apply', { fail: true }), /safe idempotency retry window/);
  assert.equal((await f.remote()).calls.length, 1);
});
