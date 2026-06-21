import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploy, type Runner, type RunResult } from './exec.js';
import type { DeployConfig } from './config.js';

const cfg: DeployConfig = {
  host: 'h', sshPort: 22, user: 'u', identityFile: '~/k', remotePath: '/srv/app', service: 'app',
  branch: 'main', runtime: 'tsx', installWhen: ['package.json'], smoke: 'started',
};

function fakeRunner(stdoutByIndex: string[]): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const runner: Runner = async (argv): Promise<RunResult> => {
    calls.push(argv);
    const stdout = stdoutByIndex[i++] ?? '';
    return { code: 0, stdout, stderr: '' };
  };
  return { runner, calls };
}

const joined = (calls: string[][]) => calls.map((c) => c.join(' '));

test('deploy runs npm ci when a dep file changed', async () => {
  const { runner, calls } = fakeRunner(['package.json\nsrc/x.ts', '', '', 'started: ok']);
  await deploy(cfg, { runner, log: () => {} });
  const all = joined(calls).join('\n');
  assert.match(all, /npm ci/);
  assert.match(all, /systemctl restart 'app'/);
});

test('deploy skips npm ci when no dep file changed', async () => {
  const { runner, calls } = fakeRunner(['src/x.ts', '', 'started: ok']);
  await deploy(cfg, { runner, log: () => {} });
  const all = joined(calls).join('\n');
  assert.doesNotMatch(all, /npm ci/);
  assert.match(all, /systemctl restart 'app'/);
});

test('deploy aborts before restart when pull fails (fail-safe ordering)', async () => {
  const calls: string[][] = [];
  const runner: Runner = async (argv) => {
    calls.push(argv);
    return { code: 1, stdout: '', stderr: 'merge conflict' }; // pull fails
  };
  await assert.rejects(() => deploy(cfg, { runner, log: () => {} }), /pull/i);
  assert.doesNotMatch(joined(calls).join('\n'), /systemctl restart/);
});
