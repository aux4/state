import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { isDeepStrictEqual } from 'node:util';

export const equal = isDeepStrictEqual;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function safe(value) {
  if (Array.isArray(value)) value.forEach(safe);
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    assert(!['__proto__', 'constructor', 'prototype'].includes(key), `Forbidden key: ${key}`);
    safe(child);
  }
  return value;
}
const refPattern = /\$\{(var|resources)\.([^}]+)\}/g;
export function interpolate(value, variables, outputs, allowUnknown = false) {
  if (Array.isArray(value)) return value.map(v => interpolate(v, variables, outputs, allowUnknown));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, variables, outputs, allowUnknown)]));
  if (typeof value !== 'string') return value;
  const get = (kind, key) => {
    let result = kind === 'var' ? variables : outputs;
    for (const part of key.split('.')) result = result != null && Object.hasOwn(result, part) ? result[part] : undefined;
    if (result === undefined && allowUnknown && kind === 'resources') return `\${resources.${key}}`;
    assert(result !== undefined, `Unresolved reference: ${kind}.${key}`);
    return result;
  };
  const matches = [...value.matchAll(refPattern)];
  if (matches.length === 1 && matches[0][0] === value) return structuredClone(get(matches[0][1], matches[0][2]));
  return value.replace(refPattern, (_, kind, key) => {
    const result = get(kind, key);
    assert(result === null || typeof result !== 'object', `Object reference must occupy the entire value: ${kind}.${key}`);
    return String(result);
  });
}
export function references(value) {
  const found = new Set();
  function visit(v) {
    if (typeof v === 'string') {
      for (const m of v.matchAll(refPattern)) if (m[1] === 'resources') found.add(m[2].split('.')[0]);
    }
    if (Array.isArray(v)) v.forEach(visit);
    else if (object(v)) Object.values(v).forEach(visit);
  }
  visit(value);
  return [...found];
}
export function sortedResources(resources) {
  const result = [], active = new Set(), done = new Set();
  function visit(name) {
    assert(resources[name], `Unknown dependency: ${name}`);
    assert(!active.has(name), `Resource dependency cycle involving ${name}`);
    if (done.has(name)) return;
    active.add(name);
    for (const dep of resources[name].dependencies) visit(dep);
    active.delete(name); done.add(name); result.push(name);
  }
  Object.keys(resources).sort().forEach(visit);
  return result;
}
export async function loadDefinitions(dir, recursive, variables) {
  const files = [];
  async function scan(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isFile() && /\.state\.ya?ml$/.test(entry.name)) files.push(path.join(folder, entry.name));
      else if (recursive && entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') await scan(path.join(folder, entry.name));
    }
  }
  await scan(dir);
  assert(files.length, `No .state.yaml or .state.yml files found in ${dir}`);
  const providers = {}, resources = {};
  for (const file of files.sort()) {
    const document = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true });
    assert(!document.errors.length, `${file}: ${document.errors.map(e => e.message).join('; ')}`);
    const data = safe(document.toJS({ maxAliasCount: 100 }));
    assert(object(data) && data.version === 1, `${file}: version must be 1`);
    for (const key of Object.keys(data)) assert(['version', 'providers', 'resources'].includes(key), `${file}: unknown field ${key}`);
    assert(object(data.resources ?? {}), `${file}: resources must be a mapping`);
    assert(object(data.providers ?? {}), `${file}: providers must be a mapping`);
    for (const [name, config] of Object.entries(data.providers ?? {})) {
      assert(/^[a-zA-Z][\w-]*$/.test(name), `Invalid provider name: ${name}`);
      assert(!Object.hasOwn(providers, name), `Duplicate provider: ${name}`);
      assert(object(config), `Invalid provider: ${name}`);
      for (const key of Object.keys(config)) assert(['package', 'command', 'config'].includes(key), `Unknown provider field: ${name}.${key}`);
      providers[name] = interpolate({ ...config, command: config.command ?? ['aux4', 'state', name, 'resource'], config: config.config ?? {} }, variables, {});
      assert(Array.isArray(providers[name].command) && providers[name].command.length && providers[name].command.every(x => typeof x === 'string' && x.length), `Invalid command for provider ${name}`);
      assert(object(providers[name].config), `Provider ${name} config must be a mapping`);
    }
    for (const [name, resource] of Object.entries(data.resources ?? {})) {
      assert(/^[a-zA-Z][\w-]*$/.test(name), `Invalid resource name: ${name}`);
      assert(!Object.hasOwn(resources, name), `Duplicate resource: ${name}`);
      assert(object(resource) && typeof resource.type === 'string' && /^[\w-]+\/[\w-]+$/.test(resource.type), `Invalid resource type: ${name}`);
      for (const key of Object.keys(resource)) assert(['type', 'properties', 'dependsOn', 'lifecycle'].includes(key), `Unknown resource field: ${name}.${key}`);
      assert(object(resource.properties ?? {}), `Properties must be a mapping: ${name}`);
      assert(resource.dependsOn === undefined || (Array.isArray(resource.dependsOn) && resource.dependsOn.every(x => typeof x === 'string')), `dependsOn must be a list: ${name}`);
      assert(resource.lifecycle === undefined || (object(resource.lifecycle) && Object.keys(resource.lifecycle).every(k => k === 'preventDestroy') && typeof resource.lifecycle.preventDestroy === 'boolean'), `Invalid lifecycle: ${name}`);
      const properties = interpolate(resource.properties ?? {}, variables, {}, true);
      resources[name] = { ...resource, properties, dependencies: [...new Set([...(resource.dependsOn ?? []), ...references(properties)])] };
    }
  }
  for (const [name, r] of Object.entries(resources)) assert(Object.hasOwn(providers, r.type.split('/')[0]), `Missing provider for ${name}: ${r.type}`);
  return { providers, resources, order: sortedResources(resources), files };
}

// Provider signatures use a deliberately small, validated JSON Schema subset.
export function validate(value, schema, location = 'properties', unknown = false) {
  if (unknown && typeof value === 'string' && value.includes('${resources.')) return value;
  if (value === undefined && Object.hasOwn(schema, 'default')) value = structuredClone(schema.default);
  if (value === undefined) return undefined;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type) assert(types.some(t => t === 'object' ? object(value) : t === 'array' ? Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : t === 'null' ? value === null : typeof value === t), `${location}: expected ${types.join(' or ')}`);
  if (schema.enum) assert(schema.enum.some(x => equal(x, value)), `${location}: invalid value`);
  if (typeof value === 'number' && schema.minimum !== undefined) assert(value >= schema.minimum, `${location}: must be >= ${schema.minimum}`);
  if (typeof value === 'string' && schema.minLength) assert(value.length >= schema.minLength, `${location}: must not be empty`);
  if (Array.isArray(value)) return value.map((v, i) => validate(v, schema.items ?? {}, `${location}[${i}]`, unknown));
  if (object(value)) {
    const result = {};
    for (const key of new Set([...Object.keys(value), ...Object.keys(schema.properties ?? {})])) {
      const childSchema = schema.properties?.[key];
      assert(childSchema || schema.additionalProperties !== false, `${location}: unsupported property ${key}`);
      const v = validate(value[key], childSchema ?? (object(schema.additionalProperties) ? schema.additionalProperties : {}), `${location}.${key}`, unknown);
      if (v !== undefined) result[key] = v;
    }
    for (const key of schema.required ?? []) assert(result[key] !== undefined, `${location}.${key}: required`);
    return result;
  }
  return value;
}
export function diff(before, after, prefix = '') {
  if (equal(before, after)) return [];
  if ((object(before) && object(after)) || (Array.isArray(before) && Array.isArray(after))) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key => diff(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return [{ path: prefix, before: before ?? null, after: after ?? null }];
}
