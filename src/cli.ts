#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig as realLoadConfig, type DeployConfig } from './config.js';
import { spawnRunner, deploy as realDeploy, type Runner } from './exec.js';
import {
  sshInvocation, remoteServiceAction, remoteStatus, remoteLogs, remoteRun,
} from './command.js';

export interface CliDeps {
  loadConfig: (cwd: string) => DeployConfig;
  runner: Runner;
  deploy: (cfg: DeployConfig, opts: { runner: Runner }) => Promise<void>;
}

const defaultDeps: CliDeps = {
  loadConfig: realLoadConfig,
  runner: spawnRunner,
  deploy: (cfg, opts) => realDeploy(cfg, opts),
};

async function confirm(action: string, yes: boolean): Promise<boolean> {
  // intentionally non-interactive: the gate is flag-only (--yes); never add a stdin prompt (would hang in CI/scripts)
  if (yes) return true;
  process.stderr.write(`Refusing destructive '${action}' without --yes. Re-run with --yes to proceed.\n`);
  return false;
}

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();
  program.name('cx').description('cryxctl — git-deploy + ops for the VPS box').version('0.1.0');
  const cfg = (): DeployConfig => deps.loadConfig(process.cwd());

  program.command('deploy')
    .description('git pull -> (npm ci if deps changed) -> restart -> smoke')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (o) => {
      if (!(await confirm('deploy', !!o.yes))) return;
      await deps.deploy(cfg(), { runner: deps.runner });
    });

  for (const action of ['restart', 'stop', 'start'] as const) {
    const cmd = program.command(action)
      .description(`sudo systemctl ${action} the service`);
    if (action !== 'start') cmd.option('-y, --yes', 'skip the confirmation prompt');
    cmd.action(async (o) => {
      if (action !== 'start' && !(await confirm(action, !!o.yes))) return;
      const r = await deps.runner(sshInvocation(cfg(), remoteServiceAction(cfg(), action)), { inherit: true });
      if (r.code !== 0) process.exitCode = r.code;
    });
  }

  program.command('status')
    .description('is-active + deployed commit + recent log')
    .action(async () => {
      const r = await deps.runner(sshInvocation(cfg(), remoteStatus(cfg())), { inherit: true });
      if (r.code !== 0) process.exitCode = r.code;
    });

  program.command('logs')
    .description('journalctl for the service')
    .option('-f, --follow', 'follow the log')
    .option('-n, --lines <n>', 'number of lines', (v) => parseInt(v, 10))
    .action(async (o) => {
      const r = await deps.runner(sshInvocation(cfg(), remoteLogs(cfg(), { follow: !!o.follow, lines: o.lines }), { tty: !!o.follow }), { inherit: true });
      if (r.code !== 0) process.exitCode = r.code;
    });

  program.command('ssh')
    .description('interactive shell on the box')
    .action(async () => {
      const r = await deps.runner(sshInvocation(cfg(), undefined, { tty: true }), { inherit: true });
      if (r.code !== 0) process.exitCode = r.code;
    });

  program.command('run')
    .description('run an arbitrary command in the remote path')
    .argument('<cmd...>', 'command to run on the box')
    .action(async (cmd: string[]) => {
      const r = await deps.runner(sshInvocation(cfg(), remoteRun(cfg(), cmd.join(' '))), { inherit: true });
      if (r.code !== 0) process.exitCode = r.code;
    });

  return program;
}

async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  }
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts')) {
  void main();
}
