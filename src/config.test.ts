import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, loadConfig } from './config.js';

const base = {
  host: '141.255.161.178', sshPort: 49222, user: 'deploy',
  identityFile: '~/.ssh/cryx_vpn', remotePath: '/home/deploy/orch-bot', service: 'orch-bot',
};

test('parseConfig accepts a full config and applies defaults', () => {
  const cfg = parseConfig(base);
  assert.equal(cfg.host, '141.255.161.178');
  assert.equal(cfg.sshPort, 49222);
  assert.equal(cfg.branch, 'main');        // default
  assert.equal(cfg.runtime, 'tsx');        // default
  assert.deepEqual(cfg.installWhen, []);   // default
  assert.equal(cfg.smoke, undefined);
});

test('parseConfig keeps provided optional fields', () => {
  const cfg = parseConfig({ ...base, branch: 'dev', runtime: 'build', installWhen: ['package.json'], smoke: 'started' });
  assert.equal(cfg.branch, 'dev');
  assert.equal(cfg.runtime, 'build');
  assert.deepEqual(cfg.installWhen, ['package.json']);
  assert.equal(cfg.smoke, 'started');
});

test('parseConfig rejects a missing required field', () => {
  const { host, ...noHost } = base;
  assert.throws(() => parseConfig(noHost), /host/);
});

test('parseConfig rejects a non-number sshPort', () => {
  assert.throws(() => parseConfig({ ...base, sshPort: '49222' }), /sshPort/);
});

test('parseConfig rejects an invalid runtime', () => {
  assert.throws(() => parseConfig({ ...base, runtime: 'webpack' }), /runtime/);
});

test('parseConfig rejects a non-object', () => {
  assert.throws(() => parseConfig(null), /object/);
});

test('loadConfig reads cryx.deploy.json from the given dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cryx-'));
  try {
    writeFileSync(join(dir, 'cryx.deploy.json'), JSON.stringify(base));
    const cfg = loadConfig(dir);
    assert.equal(cfg.service, 'orch-bot');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig throws a helpful error when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cryx-'));
  try {
    assert.throws(() => loadConfig(dir), /cryx\.deploy\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
