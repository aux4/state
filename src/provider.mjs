import { spawn } from 'node:child_process';
import { assert, object, safe } from './model.mjs';

export async function callProvider(provider, action, payload = {}) {
  const [command, ...args] = provider.command;
  const request = { version: 1, action, config: provider.config, ...payload };
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const stdout = [], stderr = []; let size = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`Provider ${action} timed out`)); }, 120000);
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 16 * 1024 * 1024) { child.kill('SIGKILL'); finish(new Error('Provider response too large')); }
      else stdout.push(data);
    });
    child.stderr.on('data', data => { if (Buffer.concat(stderr).length < 65536) stderr.push(data); });
    child.on('error', error => finish(new Error(`Cannot start provider ${command}: ${error.message}`)));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`Provider ${action} failed: ${Buffer.concat(stderr).toString().trim() || `exit ${code}`}`));
      try {
        const result = safe(JSON.parse(Buffer.concat(stdout).toString()));
        assert(object(result), 'Provider response must be a JSON object');
        finish(null, result);
      } catch (error) { finish(new Error(`Invalid provider ${action} response: ${error.message}`)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
