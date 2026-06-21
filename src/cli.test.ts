import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram, type CliDeps } from './cli.js';
import type { DeployConfig } from './config.js';
import type { Runner } from './exec.js';

const cfg: DeployConfig = {
  host: 'h', sshPort: 22, user: 'u', identityFile: '~/k', remotePath: '/srv/app', service: 'app',
  branch: 'main', runtime: 'tsx', installWhen: ['package.json'], smoke: 'started',
};

function harness() {
  const calls: string[][] = [];
  const runner: Runner = async (argv) => { calls.push(argv); return { code: 0, stdout: '', stderr: '' }; };
  let deployed = false;
  const deps: CliDeps = {
    loadConfig: () => cfg,
    runner,
    deploy: async () => { deployed = true; },
  };
  return { deps, calls, isDeployed: () => deployed };
}

async function run(args: string[], deps: CliDeps) {
  const program = buildProgram(deps);
  program.exitOverride();           // throw instead of process.exit
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  await program.parseAsync(['node', 'cx', ...args]);
}

test('`deploy` calls the injected deploy', async () => {
  const h = harness();
  await run(['deploy', '--yes'], h.deps);
  assert.equal(h.isDeployed(), true);
});

test('`restart --yes` runs sudo systemctl restart', async () => {
  const h = harness();
  await run(['restart', '--yes'], h.deps);
  assert.match(h.calls.map((c) => c.join(' ')).join('\n'), /systemctl restart 'app'/);
});

test('`logs -n 50` passes the line count through', async () => {
  const h = harness();
  await run(['logs', '-n', '50'], h.deps);
  assert.match(h.calls.map((c) => c.join(' ')).join('\n'), /journalctl -u 'app' -n 50/);
});

test('`run` forwards an arbitrary command', async () => {
  const h = harness();
  await run(['run', 'ls -la'], h.deps);
  assert.match(h.calls.map((c) => c.join(' ')).join('\n'), /cd '\/srv\/app' && ls -la/);
});
