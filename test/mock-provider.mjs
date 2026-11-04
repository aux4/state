import fs from 'node:fs/promises';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString());
const schema = { type: 'object', additionalProperties: false, required: ['name'], properties: {
  name: { type: 'string' },
  parent: { type: 'string', default: '' },
  metadata: { type: 'object', default: {} },
  items: { type: 'array', default: [] },
} };
let result;
if (request.action === 'schema') result = { version: 1, resources: { thing: { schema, immutable: ['name', 'parent'] } } };
else if (request.action === 'identity') result = { account: request.config.account ?? 'mock', mode: 'test' };
else {
  let store;
  try { store = JSON.parse(await fs.readFile(request.config.store, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; store = { next: 0, resources: {}, calls: [], keys: {} }; }
  if (request.action === 'read') result = store.resources[request.id] ? { exists: true, id: request.id, properties: store.resources[request.id] } : { exists: false };
  else if (store.keys[request.idempotencyKey]) result = store.keys[request.idempotencyKey];
  else {
    const id = request.id ?? `mock_${++store.next}`;
    store.calls.push({ action: request.action, id, resource: request.resource });
    if (request.action === 'delete') delete store.resources[id];
    else store.resources[id] = request.properties;
    result = { id };
    store.keys[request.idempotencyKey] = result;
    await fs.writeFile(request.config.store, JSON.stringify(store));
    const failFile = request.config.failOnce && request.action === request.config.failAction ? request.config.failOnce : request.config.failAfterCreate && request.action === 'create' ? request.config.failAfterCreate : null;
    if (failFile) {
      try { await fs.access(failFile); }
      catch {
        await fs.writeFile(failFile, 'failed');
        console.error(`Simulated lost ${request.action} response`); process.exit(1);
      }
    }
  }
}
console.log(JSON.stringify(result));
