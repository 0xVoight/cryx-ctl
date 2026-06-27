import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandHome, sshConnectArgs, sshInvocation,
  remotePull, needsInstall, remoteInstall, remoteServiceAction,
  remoteStatus, remoteLogs, remoteRun, remoteSmoke,
  appPath, remoteBuild, remoteHttpSmoke,
} from './command.js';
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

test('remotePull cds, ff-only pulls the branch, and prints changed files on stdout', () => {
  const s = remotePull(cfg);
  assert.match(s, /cd '\/home\/deploy\/orch-bot'/);
  assert.match(s, /git pull --ff-only origin 'main'/);
  assert.match(s, /git diff --name-only/);
});

test('needsInstall is true when a changed file matches installWhen', () => {
  assert.equal(needsInstall(['src/llm.ts', 'package.json'], cfg), true);
  assert.equal(needsInstall(['package-lock.json'], cfg), true);
});

test('needsInstall is false when nothing matches', () => {
  assert.equal(needsInstall(['src/llm.ts', 'README.md'], cfg), false);
  assert.equal(needsInstall([], cfg), false);
});

test('needsInstall supports a simple glob in installWhen', () => {
  const g = { ...cfg, installWhen: ['apps/*/package.json'] };
  assert.equal(needsInstall(['apps/web/package.json'], g), true);
  assert.equal(needsInstall(['apps/web/src/x.ts'], g), false);
});

test('remoteInstall runs npm ci in the remote path', () => {
  assert.match(remoteInstall(cfg), /cd '\/home\/deploy\/orch-bot' && npm ci/);
});

test('remoteServiceAction uses sudo systemctl <action> <service>', () => {
  assert.equal(remoteServiceAction(cfg, 'restart'), "sudo systemctl restart 'orch-bot'");
  assert.equal(remoteServiceAction(cfg, 'stop'), "sudo systemctl stop 'orch-bot'");
});

test('remoteStatus reports is-active + deployed commit + recent log', () => {
  const s = remoteStatus(cfg);
  assert.match(s, /systemctl is-active 'orch-bot'/);
  assert.match(s, /git -C '\/home\/deploy\/orch-bot' log --oneline -1/);
});

test('remoteLogs honours follow and lines', () => {
  assert.match(remoteLogs(cfg, { lines: 50 }), /journalctl -u 'orch-bot' -n 50/);
  assert.match(remoteLogs(cfg, { follow: true }), /journalctl -u 'orch-bot' .*-f/);
});

test('remoteRun runs an arbitrary command in the remote path', () => {
  assert.equal(remoteRun(cfg, 'ls -la'), "cd '/home/deploy/orch-bot' && ls -la");
});

test('remoteSmoke binds to the current service invocation, then greps the needle', () => {
  const s = remoteSmoke(cfg);
  // resolve the live invocation id of the just-restarted service…
  assert.match(s, /systemctl show -p InvocationID --value 'orch-bot'/);
  // …and scope journalctl to it, so only this run's logs are searched
  assert.match(s, /journalctl _SYSTEMD_INVOCATION_ID="\$\(/);
  assert.match(s, /grep -m1 -- 'concurrent long polling'/);
  // the buggy fixed-size tail is gone — it could surface a previous run's start line
  assert.doesNotMatch(s, /-n 30/);
});

test('remoteLogs with lines: 0 includes -n 0 (not dropped)', () => {
  assert.match(remoteLogs(cfg, { lines: 0 }), /journalctl -u 'orch-bot' -n 0/);
});

test('sq() escapes an embedded single quote via POSIX pattern', () => {
  assert.equal(
    remoteServiceAction({ ...cfg, service: "a'b" }, 'restart'),
    "sudo systemctl restart 'a'\\''b'",
  );
});

test('appPath returns remotePath when no appDir', () => {
  assert.equal(appPath(cfg), '/home/deploy/orch-bot');
});

test('appPath appends appDir when set', () => {
  assert.equal(appPath({ ...cfg, appDir: 'miniapp' }), '/home/deploy/orch-bot/miniapp');
});

test('appPath treats "." appDir as no subdir', () => {
  assert.equal(appPath({ ...cfg, appDir: '.' }), '/home/deploy/orch-bot');
});

test('remoteInstall is appDir-aware', () => {
  assert.match(remoteInstall({ ...cfg, appDir: 'miniapp' }), /cd '\/home\/deploy\/orch-bot\/miniapp' && npm ci/);
});

test('remoteBuild runs the build cmd in appPath', () => {
  assert.match(remoteBuild({ ...cfg, appDir: 'miniapp', buildCmd: 'npm run build' }), /cd '\/home\/deploy\/orch-bot\/miniapp' && npm run build/);
});

test('remoteBuild defaults to npm run build', () => {
  assert.match(remoteBuild(cfg), /npm run build/);
});

test('remoteHttpSmoke curls smokeUrl and greps the needle', () => {
  const s = remoteHttpSmoke({ ...cfg, smokeUrl: 'http://127.0.0.1:13033/', smoke: 'Cryzothic Core' });
  assert.match(s, /curl -fsS 'http:\/\/127\.0\.0\.1:13033\/'/);
  assert.match(s, /grep -m1 -- 'Cryzothic Core'/);
});
