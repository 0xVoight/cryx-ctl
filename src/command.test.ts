import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome, sshConnectArgs, sshInvocation } from './command.js';
import type { DeployConfig } from './config.js';

const cfg: DeployConfig = {
  host: '141.255.161.178', sshPort: 49222, user: 'deploy',
  identityFile: '~/.ssh/cryx_vpn', remotePath: '/home/deploy/orch-bot', service: 'orch-bot',
  branch: 'main', runtime: 'tsx', installWhen: ['package.json', 'package-lock.json'], smoke: 'concurrent long polling',
};

test('expandHome replaces a leading ~ with the home dir', () => {
  assert.equal(expandHome('~/.ssh/cryx_vpn', '/home/me'), '/home/me/.ssh/cryx_vpn');
});

test('expandHome leaves an absolute path untouched', () => {
  assert.equal(expandHome('/etc/key', '/home/me'), '/etc/key');
});

test('sshConnectArgs builds -i / -p / user@host (no tty by default)', () => {
  assert.deepEqual(sshConnectArgs(cfg, { tty: false } as any), [
    '-i', expandHome(cfg.identityFile), '-p', '49222', 'deploy@141.255.161.178',
  ]);
});

test('sshConnectArgs adds -tt when tty requested', () => {
  const args = sshConnectArgs(cfg, { tty: true });
  assert.ok(args.includes('-tt'), 'expected -tt for tty');
});

test('sshInvocation prefixes ssh and appends the remote command', () => {
  const argv = sshInvocation(cfg, 'echo hi');
  assert.equal(argv[0], 'ssh');
  assert.equal(argv.at(-1), 'echo hi');
  assert.ok(argv.includes('deploy@141.255.161.178'));
});

test('sshInvocation with no remote command is an interactive login', () => {
  const argv = sshInvocation(cfg, undefined, { tty: true });
  assert.equal(argv[0], 'ssh');
  assert.equal(argv.at(-1), 'deploy@141.255.161.178'); // host is last → interactive shell
});
