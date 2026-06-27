import os from 'node:os';
import { basename } from 'node:path';
import type { DeployConfig } from './config.js';

export function expandHome(p: string, home: string = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return home + p.slice(1);
  return p;
}

export interface SshOpts { tty?: boolean }

/** Base ssh args after `ssh`, before any remote command. */
export function sshConnectArgs(cfg: DeployConfig, opts: SshOpts = {}): string[] {
  const args = ['-i', expandHome(cfg.identityFile), '-p', String(cfg.sshPort)];
  if (opts.tty) args.push('-tt');
  args.push(`${cfg.user}@${cfg.host}`);
  return args;
}

/** Full argv to spawn. `remote` undefined → interactive login shell. */
export function sshInvocation(cfg: DeployConfig, remote: string | undefined, opts: SshOpts = {}): string[] {
  const argv = ['ssh', ...sshConnectArgs(cfg, opts)];
  if (remote !== undefined) argv.push(remote);
  return argv;
}

/** Single-quote a value for safe embedding in a remote POSIX shell command. */
function sq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Pull the configured branch (fast-forward only) and print the changed files on stdout
 * (pull chatter goes to stderr). The caller diffs the captured stdout against installWhen.
 */
export function remotePull(cfg: DeployConfig): string {
  const path = sq(cfg.remotePath);
  return `cd ${path} && b="$(git rev-parse HEAD)" && git pull --ff-only origin ${sq(cfg.branch)} 1>&2 && git diff --name-only "$b" HEAD`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

export function needsInstall(changed: string[], cfg: DeployConfig): boolean {
  return cfg.installWhen.some((pat) =>
    changed.some((f) => {
      if (f === pat) return true;
      if (!pat.includes('/') && basename(f) === pat) return true;
      return globToRegExp(pat).test(f);
    }),
  );
}

/** Resolve the app's build/install directory: remotePath, plus appDir when it is a real subdir. */
export function appPath(cfg: DeployConfig): string {
  const dir = cfg.appDir;
  return dir && dir !== '.' ? `${cfg.remotePath}/${dir}` : cfg.remotePath;
}

export function remoteInstall(cfg: DeployConfig): string {
  return `cd ${sq(appPath(cfg))} && npm ci`;
}

export function remoteBuild(cfg: DeployConfig): string {
  return `cd ${sq(appPath(cfg))} && ${cfg.buildCmd ?? 'npm run build'}`;
}

export function remoteHttpSmoke(cfg: DeployConfig): string {
  const needle = cfg.smoke ?? '';
  return `curl -fsS ${sq(cfg.smokeUrl ?? '')} | grep -m1 -- ${sq(needle)}`;
}

export function remoteServiceAction(cfg: DeployConfig, action: 'restart' | 'stop' | 'start'): string {
  return `sudo systemctl ${action} ${sq(cfg.service)}`;
}

export function remoteStatus(cfg: DeployConfig): string {
  const svc = sq(cfg.service);
  return `systemctl is-active ${svc}; git -C ${sq(cfg.remotePath)} log --oneline -1; sudo journalctl -u ${svc} -n 10 --no-pager`;
}

export interface LogOpts { follow?: boolean; lines?: number }

export function remoteLogs(cfg: DeployConfig, opts: LogOpts = {}): string {
  const parts = [`sudo journalctl -u ${sq(cfg.service)}`];
  if (opts.lines !== undefined) parts.push(`-n ${opts.lines}`);
  if (opts.follow) parts.push('-f');
  else parts.push('--no-pager');
  return parts.join(' ');
}

export function remoteRun(cfg: DeployConfig, rawCmd: string): string {
  return `cd ${sq(cfg.remotePath)} && ${rawCmd}`;
}

export function remoteSmoke(cfg: DeployConfig): string {
  const svc = sq(cfg.service);
  const needle = cfg.smoke ?? '';
  // Scope to the service's CURRENT systemd invocation, not a fixed -n tail.
  // A fixed tail can surface a *previous* run's start line (a stale false-OK);
  // the invocation id uniquely identifies this restart, so only its logs match.
  return `sudo journalctl _SYSTEMD_INVOCATION_ID="$(systemctl show -p InvocationID --value ${svc})" --no-pager | grep -m1 -- ${sq(needle)}`;
}
