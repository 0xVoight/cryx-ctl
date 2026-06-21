import os from 'node:os';
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
