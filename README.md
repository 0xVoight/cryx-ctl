# cryx-ctl (`cx` / `cryxctl`)

Config-driven TypeScript/Node CLI for the end-to-end dev-to-VPS loop. One binary handles the full ops surface — deploy via git-pull, logs, status, restart/stop/start, interactive SSH, and arbitrary remote commands — all driven by a per-project `cryx.deploy.json` in the target repo. First consumer: `orch-bot` on `cryx-vpn-1`. Adding a second project requires only dropping a config file; no CLI code change needed.

---

## Install

Requirements: Node >= 22.

```sh
git clone https://github.com/0xVoight/cryx-ctl.git
cd cryx-ctl
npm install
npm run build      # compiles src/ → dist/
npm link           # puts `cx` and `cryxctl` on PATH
```

Verify:

```sh
cx --help
```

---

## Config (`cryx.deploy.json`)

Place this file in the **target project's repo root** (e.g. the `v-bot` repo for orch-bot), not in cryx-ctl itself. It is versioned with the target project.

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | required | VPS IP or hostname |
| `sshPort` | number | required | SSH port |
| `user` | string | required | SSH username |
| `identityFile` | string | required | Path to SSH private key (`~` is expanded) |
| `remotePath` | string | required | Absolute path to the service directory on the box |
| `service` | string | required | systemd service name (used with `systemctl` and `journalctl`) |
| `branch` | string | `"main"` | Git branch to pull |
| `runtime` | `"tsx"` \| `"build"` | `"tsx"` | `"tsx"` = no build step (run via tsx); `"build"` = insert `npm run build` before restart |
| `installWhen` | string[] | `[]` | Glob list; if `git pull` changed any matching file, `npm ci` runs before restart; otherwise the install step is skipped for a fast deploy |
| `smoke` | string | _(optional)_ | String to `grep -m1` in the post-restart journal as a success signal |

### Example — orch-bot

```json
{
  "host": "141.255.161.178",
  "sshPort": 49222,
  "user": "deploy",
  "identityFile": "~/.ssh/cryx_vpn",
  "remotePath": "/home/deploy/orch-bot",
  "service": "orch-bot",
  "branch": "main",
  "runtime": "tsx",
  "installWhen": ["package.json", "package-lock.json"],
  "smoke": "concurrent long polling"
}
```

---

## Commands

Run all commands from the directory that contains `cryx.deploy.json`. Destructive operations (`deploy`, `restart`, `stop`) require `--yes` unless confirmed interactively.

| Command | Effect |
|---|---|
| `cx deploy [--yes]` | `git pull origin <branch>` on box → `npm ci` if an `installWhen` file changed → `sudo systemctl restart <service>` → smoke-grep journal |
| `cx logs [-f] [-n N]` | `journalctl -u <service>`; `-f` follows, `-n N` sets tail line count |
| `cx status` | `systemctl is-active <service>` + deployed git commit one-liner + recent journal lines |
| `cx restart [--yes]` | `sudo systemctl restart <service>` |
| `cx stop [--yes]` | `sudo systemctl stop <service>` |
| `cx start` | `sudo systemctl start <service>` |
| `cx ssh` | Interactive shell on the box (`ssh -tt`) |
| `cx run "<cmd>"` | Run an arbitrary command in `<remotePath>` on the box |

Non-deploy subcommands (`logs`, `status`, `restart`, `stop`, `start`, `run`) propagate the remote command's exit code to the local process. `deploy` throws (exit 1) on any failure.

---

## Safety

- `.env` never leaves the box. It is git-ignored in the target repo; `cx deploy` uses `git pull` which never touches it. The CLI never reads, prints, or transmits `.env`.
- The CLI only shells out to the system `ssh -i <identityFile>`. It holds no crypto and performs no key operations itself.
- **Single-poller rule:** `deploy` uses `systemctl restart`, never a second `start`. Only one instance of a long-polling bot may run at a time.
- **Fail-safe ordering:** in `deploy`, `git pull` must succeed before `npm ci`, which must succeed before `restart`. A failure at any step aborts before the next.
- **SSH keys:** the orch-bot config uses `~/.ssh/cryx_vpn`, a passphrase-less ed25519 key (rotated 2026-06-22), so `cx` requires no ssh-agent for this key. For keys that carry a passphrase, ensure your ssh-agent has the key loaded (`ssh-add <keyfile>`) or that an askpass helper is configured — `cx` passes only `-i <identityFile>` and delegates passphrase handling entirely to the OS.

---

## Known Limitations

**Smoke-check staleness:** the post-restart smoke check greps the last ~30 journal lines with `grep -m1` and has no `--since` filter tied to the exact restart moment. It can match a startup line from a previous restart if the journal window spans the previous run. It confirms "a startup line exists in recent history," not specifically the line from the current restart. The deploy itself (git pull + restart) will still have succeeded; only the smoke confirmation may be slightly stale. Backlog: bind the smoke to the restart moment with `--since`.

---

## Testing and Development

```sh
npm test          # runs all unit tests via node:test + tsx (no SSH required)
npm run typecheck # tsc noEmit — must be clean before commit
```

The pure core (`config.ts`, `command.ts`, `exec.ts` deploy orchestration) is fully unit-tested without SSH. The live SSH seam (`spawnRunner`) and live deploy are verified manually against the box.

Toolchain: Node >= 22, TypeScript 6, ESM `nodenext` (`.js` import extensions in source), `commander`, `tsx`. `tsconfig.json` must include `"types": ["node"]`.
