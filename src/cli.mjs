import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { assert, safe, object, loadDefinitions } from './model.mjs';
import { Storage } from './storage.mjs';
import { Engine } from './engine.mjs';

function bool(value) { assert(['true', 'false'].includes(value), `Expected true or false, got ${value}`); return value === 'true'; }
function publicPlan(plan) {
  const counts = { create: 0, update: 0, replace: 0, destroy: 0, noop: 0, retire: 0 };
  for (const s of plan.steps) counts[s.action]++;
  return { environment: plan.environment, changes: plan.steps.map(({ name, type, action, changes }) => ({ name, type, action, changes })), counts };
}
function printPlan(plan, format) {
  const view = publicPlan(plan);
  if (format === 'json') { console.log(JSON.stringify(view, null, 2)); return; }
  console.log(`Environment: ${plan.environment}`);
  for (const s of view.changes) {
    console.log(`${{ create: '+', update: '~', replace: '-/+', destroy: '-', noop: '=', retire: '-' }[s.action]} ${s.name} (${s.type}): ${s.action}`);
    for (const c of s.changes) console.log(`    ${c.path}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }
  const c = view.counts;
  console.log(`Plan: ${c.create} create, ${c.update} update, ${c.replace} replace, ${c.destroy + c.retire} destroy, ${c.noop} unchanged.`);
}
async function main() {
  const [action, dirArg = '.', environment = 'default', stateDir = '.aux4-state', recursiveArg = 'false', variablesArg = '{}', format = 'text', ...extra] = process.argv.slice(2);
  assert(['validate', 'plan', 'apply', 'destroy', 'inspect', 'import'].includes(action), 'Unknown state command');
  assert(['text', 'json'].includes(format), 'format must be text or json');
  const variables = safe(JSON.parse(variablesArg));
  assert(object(variables), 'variables must be an object');
  const recursive = bool(recursiveArg), dir = path.resolve(dirArg);
  const storage = new Storage(dir, stateDir, environment);
  if (action === 'inspect') { console.log(JSON.stringify(await storage.read(), null, 2)); return; }
  const write = ['apply', 'destroy', 'import'].includes(action);
  if (write) await storage.acquire();
  try {
    const state = await storage.read();
    // Full destruction can proceed even after all definition files have been removed.
    let definitions;
    if (action === 'destroy') definitions = { providers: {}, resources: {}, order: [] };
    else definitions = await loadDefinitions(dir, recursive, variables);
    const engine = new Engine(definitions, storage, variables);
    await engine.initialize(state, action === 'validate');
    if (action === 'validate') {
      console.log(format === 'json' ? JSON.stringify({ valid: true, resources: Object.keys(definitions.resources).length }, null, 2) : `Valid: ${Object.keys(definitions.resources).length} resources.`);
      return;
    }
    if (action === 'import') {
      assert(extra[0] && extra[1], 'resource and id are required');
      await engine.import(extra[0], extra[1]);
      console.log(format === 'json' ? JSON.stringify({ imported: extra[0], id: extra[1] }, null, 2) : `Imported ${extra[0]}: ${extra[1]}`);
      return;
    }
    const plan = await engine.plan(action === 'destroy');
    if (!write) { printPlan(plan, format); return; }
    const changes = plan.steps.some(s => s.action !== 'noop') || state.operation;
    if (!bool(extra[0] ?? 'false') && changes) {
      printPlan(plan, format);
      assert(process.stdin.isTTY, 'Non-interactive apply requires --yes true');
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      try { assert((await reader.question(`Apply to ${environment}? Type yes: `)).trim() === 'yes', 'Cancelled'); }
      finally { reader.close(); }
    }
    await engine.apply(plan);
    if (format === 'json') console.log(JSON.stringify({ ...publicPlan(plan), applied: true }, null, 2));
    else { printPlan(plan, format); console.log('Applied.'); }
  } finally { if (write) await storage.release(); }
}
main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
