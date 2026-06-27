import { spawn } from 'node:child_process';
import type { DeployConfig } from './config.js';
import {
  sshInvocation, remotePull, needsInstall, remoteInstall, remoteServiceAction, remoteSmoke,
  remoteBuild, remoteHttpSmoke,
} from './command.js';

export interface RunResult { code: number; stdout: string; stderr: string }
export type Runner = (argv: string[], opts?: { inherit?: boolean }) => Promise<RunResult>;

/** Real seam: spawn argv[0] (ssh) with the rest. `inherit` streams to the terminal; otherwise capture. */
export const spawnRunner: Runner = (argv, opts = {}) =>
  new Promise((resolve, reject) => {
    const [cmd, ...rest] = argv;
    if (!cmd) { reject(new Error('empty argv')); return; }
    const child = spawn(cmd, rest, { stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

export interface DeployOpts { runner?: Runner; log?: (m: string) => void }

export async function deploy(cfg: DeployConfig, opts: DeployOpts = {}): Promise<void> {
  const runner = opts.runner ?? spawnRunner;
  const log = opts.log ?? ((m: string) => console.log(m));

  // 1. pull (capture changed files on stdout)
  const pull = await runner(sshInvocation(cfg, remotePull(cfg)), { inherit: false });
  if (pull.code !== 0) throw new Error(`git pull failed:\n${pull.stderr || pull.stdout}`);
  const changed = pull.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  log(changed.length ? `changed: ${changed.join(', ')}` : 'already up to date');

  // 2. npm ci only if a dep file changed (fast deploy otherwise)
  if (needsInstall(changed, cfg)) {
    log('deps changed -> npm ci');
    const ci = await runner(sshInvocation(cfg, remoteInstall(cfg)), { inherit: true });
    if (ci.code !== 0) throw new Error('npm ci failed');
  } else {
    log('no dep change -> skip npm ci');
  }

  // static SPA path: build + HTTP smoke, no systemctl (Caddy serves the rebuilt dist live)
  if (cfg.kind === 'static') {
    log(`building -> ${cfg.buildCmd ?? 'npm run build'}`);
    const build = await runner(sshInvocation(cfg, remoteBuild(cfg)), { inherit: true });
    if (build.code !== 0) throw new Error('build failed');
    if (cfg.smokeUrl) {
      const smoke = await runner(sshInvocation(cfg, remoteHttpSmoke(cfg)), { inherit: false });
      log(smoke.code === 0 && smoke.stdout.trim()
        ? `smoke OK: ${smoke.stdout.trim()}`
        : `smoke MISSING (no '${cfg.smoke}' at ${cfg.smokeUrl})`);
    }
    log('deploy done');
    return;
  }

  // 3. restart (never a second start: single-poller rule)
  const restart = await runner(sshInvocation(cfg, remoteServiceAction(cfg, 'restart')), { inherit: true });
  if (restart.code !== 0) throw new Error('systemctl restart failed');

  // 4. smoke check
  if (cfg.smoke) {
    const smoke = await runner(sshInvocation(cfg, remoteSmoke(cfg)), { inherit: false });
    log(smoke.code === 0 && smoke.stdout.trim()
      ? `smoke OK: ${smoke.stdout.trim()}`
      : `smoke MISSING (no '${cfg.smoke}' in recent journal)`);
  }
  log('deploy done');
}
