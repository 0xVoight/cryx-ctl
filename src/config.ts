import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DeployConfig {
  host: string;
  sshPort: number;
  user: string;
  identityFile: string;
  remotePath: string;
  service: string;
  branch: string;
  runtime: 'tsx' | 'build';
  installWhen: string[];
  smoke?: string;
}

function reqString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`cryx config: "${key}" must be a non-empty string`);
  return v;
}

export function parseConfig(raw: unknown): DeployConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('cryx config: expected a JSON object');
  }
  const o = raw as Record<string, unknown>;

  const sshPort = o.sshPort;
  if (typeof sshPort !== 'number' || !Number.isInteger(sshPort)) {
    throw new Error('cryx config: "sshPort" must be an integer');
  }

  const runtime = o.runtime ?? 'tsx';
  if (runtime !== 'tsx' && runtime !== 'build') {
    throw new Error('cryx config: "runtime" must be "tsx" or "build"');
  }

  let installWhen: string[] = [];
  if (o.installWhen !== undefined) {
    if (!Array.isArray(o.installWhen) || o.installWhen.some((s) => typeof s !== 'string')) {
      throw new Error('cryx config: "installWhen" must be an array of strings');
    }
    installWhen = o.installWhen as string[];
  }

  if (o.smoke !== undefined && typeof o.smoke !== 'string') {
    throw new Error('cryx config: "smoke" must be a string');
  }

  const branch = o.branch === undefined ? 'main' : o.branch;
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error('cryx config: "branch" must be a non-empty string');
  }

  return {
    host: reqString(o, 'host'),
    sshPort,
    user: reqString(o, 'user'),
    identityFile: reqString(o, 'identityFile'),
    remotePath: reqString(o, 'remotePath'),
    service: reqString(o, 'service'),
    branch,
    runtime,
    installWhen,
    smoke: o.smoke as string | undefined,
  };
}

export function loadConfig(cwd: string): DeployConfig {
  const path = join(cwd, 'cryx.deploy.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cryx: no cryx.deploy.json found in ${cwd} (expected ${path})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`cryx: cryx.deploy.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  return parseConfig(raw);
}
