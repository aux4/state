import { randomUUID } from 'node:crypto';
import { assert, equal, object, validate, interpolate, sortedResources, diff } from './model.mjs';
import { callProvider } from './provider.mjs';

export class Engine {
  constructor(definitions, storage, variables, call = callProvider) {
    this.definitions = definitions; this.storage = storage; this.variables = variables; this.call = call;
    this.providers = {}; this.signatures = {}; this.identities = {};
  }
  async initialize(state, offline = false) {
    this.state = state;
    this.providers = { ...state.providers, ...this.definitions.providers };
    for (const [name, provider] of Object.entries(this.providers)) {
      const { identity: ignored, ...descriptor } = provider;
      this.providers[name] = descriptor;
      const signature = await this.call(descriptor, 'schema');
      assert(signature.version === 1 && object(signature.resources), `Invalid provider signature: ${name}`);
      for (const [type, spec] of Object.entries(signature.resources)) {
        assert(object(spec.schema) && Array.isArray(spec.immutable), `Invalid resource signature: ${name}/${type}`);
      }
      this.signatures[name] = signature.resources;
      if (!offline) {
        const identity = await this.call(descriptor, 'identity');
        assert(Object.keys(identity).length, `Provider ${name} returned an empty identity`);
        if (state.providers[name]) assert(equal(state.providers[name].identity, identity), `Provider ${name} account/environment identity differs from the saved state`);
        this.identities[name] = identity;
      }
    }
    for (const [name, r] of Object.entries(this.definitions.resources)) validate(r.properties, this.spec(r.type).schema, name, true);
  }
  spec(type) {
    const [provider, resource] = type.split('/');
    const spec = this.signatures[provider]?.[resource];
    assert(spec, `Unsupported resource type: ${type}`);
    return spec;
  }
  async request(type, action, payload = {}) {
    const [provider, resource] = type.split('/');
    return this.call(this.providers[provider], action, { type: resource, ...payload });
  }
  savedProviders() {
    return Object.fromEntries(Object.entries(this.providers).map(([name, p]) => [name, { ...p, identity: this.identities[name] }]));
  }
  async plan(destroy = false) {
    const steps = [], outputs = {}, desired = destroy ? {} : this.definitions.resources;
    for (const name of destroy ? [] : this.definitions.order) {
      const resource = desired[name], old = this.state.resources[name];
      const spec = this.spec(resource.type);
      const properties = validate(interpolate(resource.properties, this.variables, outputs, true), spec.schema, name, true);
      let current = null;
      if (old) {
        const response = await this.request(old.type, 'read', { id: old.id });
        assert(typeof response.exists === 'boolean', `Invalid read response: ${name}`);
        if (response.exists) {
          assert(object(response.properties), `Missing read properties: ${name}`);
          current = response.properties;
        }
      }
      const changes = diff(current ?? {}, properties);
      let action = !current ? 'create' : old.type !== resource.type ? 'replace' : changes.length ? 'update' : 'noop';
      if (action === 'update' && changes.some(c => spec.immutable.some(p => c.path === p || c.path.startsWith(p + '.')))) action = 'replace';
      if (action === 'replace') assert(!old.preventDestroy && !resource.lifecycle?.preventDestroy, `Resource ${name} has preventDestroy enabled`);
      steps.push({ name, type: resource.type, action, changes, properties, current, old, dependencies: resource.dependencies, preventDestroy: resource.lifecycle?.preventDestroy ?? false });
      const id = action === 'create' || action === 'replace' ? `\${resources.${name}.id}` : old.id;
      outputs[name] = { id, properties };
    }
    const oldOrder = sortedResources(Object.fromEntries(Object.entries(this.state.resources).map(([name, r]) => [name, { dependencies: (r.dependencies ?? []).filter(d => Object.hasOwn(this.state.resources, d)) }])));
    for (const name of oldOrder.reverse()) {
      if (Object.hasOwn(desired, name)) continue;
      const old = this.state.resources[name];
      assert(!old.preventDestroy, `Resource ${name} has preventDestroy enabled`);
      steps.push({ name, type: old.type, action: 'destroy', old, changes: [] });
    }
    for (const pending of [...this.state.pending].reverse()) steps.push({ name: pending.name, type: pending.type, action: 'retire', old: pending, changes: [] });
    return { environment: this.storage.environment, destroy, steps };
  }
  async mutate(type, action, payload) {
    const operation = JSON.parse(JSON.stringify({ type, action, payload }));
    if (this.state.operation) {
      const { key, startedAt, ...saved } = this.state.operation;
      assert(equal(saved, operation), 'An interrupted operation is pending. Restore the previous definitions and rerun the same command before making other changes.');
    } else {
      this.state.operation = { ...operation, key: randomUUID(), startedAt: new Date().toISOString() };
      await this.storage.write(this.state);
    }
    return this.request(type, action, { ...payload, idempotencyKey: this.state.operation.key });
  }
  async apply(plan) {
    this.state.providers = this.savedProviders();
    // Persist identity before the first remote write, including a new stack's ID.
    await this.storage.write(this.state);
    if (this.state.operation) {
      await this.resume(plan.destroy);
      plan = await this.plan(plan.destroy);
    }
    for (const step of plan.steps.filter(s => !['destroy', 'retire'].includes(s.action))) {
      const outputs = Object.fromEntries(Object.entries(this.state.resources).map(([name, r]) => [name, { id: r.id, properties: r.properties }]));
      const desired = this.definitions.resources[step.name];
      const properties = validate(interpolate(desired.properties, this.variables, outputs), this.spec(step.type).schema, step.name);
      let id = step.old?.id;
      if (step.action !== 'noop') {
        const action = step.action === 'update' ? 'update' : 'create';
        const response = await this.mutate(step.type, action, { ...(action === 'update' ? { id } : {}), properties, previous: ['update', 'replace'].includes(step.action) ? step.current : undefined, replaces: step.action === 'replace' && step.old.type === step.type ? step.old.id : undefined, resource: step.name, stackId: this.state.stackId });
        assert(typeof response.id === 'string' && response.id, `Provider ${action} did not return an ID`);
        if (step.action === 'replace') this.state.pending.push({ ...step.old, name: step.name });
        id = response.id;
      }
      this.state.resources[step.name] = { type: step.type, id, properties, dependencies: step.dependencies, preventDestroy: step.preventDestroy };
      this.state.operation = null;
      await this.storage.write(this.state);
    }
    // Use the OLD dependency graph for both removals and replacement retirement.
    // Desired dependencies may have changed or reversed since those IDs were created.
    const retirements = [
      ...plan.steps.filter(s => s.action === 'destroy').map(s => ({ ...s.old, name: s.name, tracked: true })),
      ...this.state.pending,
    ];
    const graph = Object.fromEntries(retirements.map(r => [r.name, { dependencies: [] }]));
    for (const r of retirements) graph[r.name].dependencies = [...new Set([...graph[r.name].dependencies, ...(r.dependencies ?? []).filter(d => Object.hasOwn(graph, d))])];
    for (const name of sortedResources(graph).reverse()) {
      for (const old of retirements.filter(r => r.name === name)) {
        await this.mutate(old.type, 'delete', { id: old.id });
        if (old.tracked) delete this.state.resources[old.name];
        else this.state.pending = this.state.pending.filter(r => !(r.type === old.type && r.id === old.id));
        this.state.operation = null;
        await this.storage.write(this.state);
      }
    }
    assert(!this.state.operation, 'Interrupted operation remains pending; rerun with the previous definitions');
  }
  async resume(destroy) {
    const { type, action, payload, key, startedAt } = this.state.operation;
    assert(startedAt && Date.now() - Date.parse(startedAt) < 23 * 60 * 60 * 1000, 'Interrupted operation is older than the safe idempotency retry window. Inspect the remote resource and reconcile the journal manually before continuing.');
    if (action === 'create' || action === 'update') {
      const desired = this.definitions.resources[payload.resource];
      assert(!destroy && desired?.type === type, 'Resume the interrupted apply with its original definitions before destroying or changing resources');
      const outputs = Object.fromEntries(Object.entries(this.state.resources).map(([n, r]) => [n, { id: r.id, properties: r.properties }]));
      const properties = validate(interpolate(desired.properties, this.variables, outputs), this.spec(type).schema, payload.resource);
      assert(equal(properties, payload.properties), 'An interrupted operation is pending. Restore the previous resource properties and rerun apply.');
      const response = await this.request(type, action, { ...payload, idempotencyKey: key });
      assert(typeof response.id === 'string' && response.id, 'Resumed mutation did not return an ID');
      const old = this.state.resources[payload.resource];
      if (action === 'create' && old && old.id !== response.id) this.state.pending.push({ ...old, name: payload.resource });
      this.state.resources[payload.resource] = { type, id: response.id, properties, dependencies: desired.dependencies, preventDestroy: desired.lifecycle?.preventDestroy ?? false };
    } else {
      assert(action === 'delete', 'Unknown pending operation');
      const managed = Object.entries(this.state.resources).find(([, r]) => r.type === type && r.id === payload.id);
      assert(!managed || destroy || !this.definitions.resources[managed[0]], 'Resume the interrupted deletion with the resource removed from definitions');
      await this.request(type, action, { ...payload, idempotencyKey: key });
      if (managed) delete this.state.resources[managed[0]];
      this.state.pending = this.state.pending.filter(r => !(r.type === type && r.id === payload.id));
    }
    this.state.operation = null;
    await this.storage.write(this.state);
  }
  async import(name, id) {
    const resource = this.definitions.resources[name];
    assert(resource, `Unknown resource: ${name}`);
    assert(!this.state.resources[name], `Resource is already managed: ${name}`);
    assert(!this.state.operation, 'Cannot import during an interrupted operation');
    assert(!Object.values(this.state.resources).some(r => r.type === resource.type && r.id === id), 'Remote resource is already managed under another name');
    const remote = await this.request(resource.type, 'read', { id });
    assert(remote.exists && object(remote.properties), `Remote resource not found: ${id}`);
    this.state.providers = this.savedProviders();
    this.state.resources[name] = { type: resource.type, id, properties: remote.properties, dependencies: resource.dependencies, preventDestroy: resource.lifecycle?.preventDestroy ?? false };
    await this.storage.write(this.state);
  }
}
