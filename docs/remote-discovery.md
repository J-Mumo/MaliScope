# Remote discovery runbook

Run the MaliScope discovery crawler from an operator laptop and persist drafts
directly into the production database over an SSH tunnel.

## When to use this

Some source sites (Jiji, PropertyPro, BuyRentKenya, and sometimes Equity) sit
behind Cloudflare or Imperva and return HTTP 403 to requests from the Hetzner
VM's IP range while serving 200 to residential IPs. Getting each site to
allowlist the deployment IP takes weeks. This runbook is the interim: crawl
from your laptop (residential IP) and write results to the production Postgres.

Do **not** use this flow for:

- Kenya Property Centre, HassConsult, Knight Frank — they already work from the
  VM, so the nightly cron on the VM covers them.
- HF Marketplace — its hostname currently fails DNS (`ENOTFOUND`) from every
  machine, laptop or VM. A tunnel changes nothing.

## Prerequisites (one-time)

### On the VM

`docker-compose.yml` on `main` publishes Postgres on `127.0.0.1:5433`
(loopback only, not the public interface). Roll that forward once:

```bash
ssh stockup@2.28.75.21
cd ~/apps/maliscope
git pull
docker compose up -d postgres

# Confirm the loopback binding:
docker port maliscope-postgres-1 5432/tcp
# Expected: 127.0.0.1:5433
```

### On the laptop

1. Node.js 22+ and npm installed (matches `package.json` `engines.node`).
2. The MaliScope repo checked out at `C:\Eng\MaliScope` on `main`.
3. `npm install` completed.
4. `ssh` on `PATH` (Windows 10/11's OpenSSH client is fine).
5. Your SSH key at `C:\Users\JOEL\.ssh\id_ed25519` authorised on the VM (already
   set up per `C:\Eng\StockUp\deploy\README.md`).
6. The production DB password. Fetch it once and keep it in your password
   manager:

   ```powershell
   ssh stockup@2.28.75.21 "grep '^PGPASSWORD=' ~/apps/maliscope/.env"
   ```

## Running a crawl

From `C:\Eng\MaliScope` on the laptop:

```powershell
npm run job:discover:remote
```

The **first** run prompts for `PGPASSWORD` (input masked) and offers to cache
it. The **subsequent** runs read the cached value silently.

The helper at [`scripts/run-remote-discovery.ps1`](../scripts/run-remote-discovery.ps1)
then:

1. Loads the cached password, or prompts and (optionally) caches it.
2. Verifies Postgres is published on the VM loopback.
3. Opens `ssh -N -L 55432:127.0.0.1:5433 stockup@2.28.75.21` in the background.
4. Waits for the tunnel to accept TCP.
5. Sets `DATABASE_URL=postgresql://maliscope:<password>@127.0.0.1:55432/maliscope`.
6. Runs `npm run job:discover` (which is `tsx src/jobs/run-discovery.ts`).
7. On exit — success, failure, or Ctrl+C — kills the tunnel and clears
   `DATABASE_URL`.

Expected runtime: ~2–4 minutes. The crawler is rate-limited to one detail
request per second per source and caps at 20 detail pages per source per run.

### Password caching

The cached password lives at:

```
%LOCALAPPDATA%\MaliScope\pg-password.dpapi
```

Encrypted with the **Windows Data Protection API (DPAPI)** at user + machine
scope, plus a hardened NTFS ACL that only your Windows account can read. That
means:

- No admin needed, no PowerShell modules to install.
- Copying the file to another PC or another Windows account makes it garbage —
  only your logged-in account on this specific machine can decrypt it.
- If your Windows profile is corrupted or you re-image the laptop, the cache
  becomes unreadable and the script silently falls back to prompting.

To rotate the cache — for example after `PGPASSWORD` changes on the VM:

```powershell
npm run job:discover:remote -- -ResetPassword
```

To clear the cache manually without rotating:

```powershell
Remove-Item "$env:LOCALAPPDATA\MaliScope\pg-password.dpapi"
```

If the DB rejects a cached password (auth failure), the script prints a hint
suggesting `-ResetPassword`.

## Verifying the run

### At the JSON level

The script prints the same per-source result array as the VM job. A healthy
result for a Cloudflare-fronted source looks like this instead of the 403 you
saw from the VM:

```json
{
  "sourceId": "jiji-kenya",
  "candidateLinks": 20,
  "imported": 20,
  "failed": 0,
  "verified": 0,
  "refreshed": 0,
  "delisted": 0,
  "errors": []
}
```

### At the DB level

```powershell
ssh stockup@2.28.75.21 "cd ~/apps/maliscope && docker compose exec -T postgres psql -U maliscope -d maliscope -c \""SELECT job_name, status, started_at FROM job_runs ORDER BY started_at DESC LIMIT 5;\"""
```

The most recent row should be `discover:websites` with `status = completed`.

### At the UI level

Refresh <https://maliscope.jmumo.com/discovery>. New cards for the previously
blocked sources should appear, ordered by policy outcome, then completeness.

## Cadence

- **From the VM (automatic):** the cron at `05:00 UTC` continues to run the
  same job against every approved source. Sources that work from the VM keep
  landing daily.
- **From the laptop (manual):** run `npm run job:discover:remote` when you
  want Jiji / PropertyPro / BuyRentKenya coverage refreshed. Weekly is a
  reasonable default; the pagination cursor for Jiji advances 20 pages per
  run through its 25-page category before cycling.
- **From the laptop (scheduled):** register a Windows Task Scheduler entry
  (see next section) if you want the laptop-side run to happen unattended
  whenever you are logged on.

Both flows write to the same tables and the same `job_runs` audit log, so the
Jiji cursor is shared and never double-walked.

## Scheduling on Windows

`scripts/register-remote-discovery-task.ps1` wraps
`Register-ScheduledTask` so the same runner fires on a schedule with no
prompts. It reuses the DPAPI cache, so the setup is:

1. Populate the cache once:
   ```powershell
   npm run job:discover:remote
   # answer 'y' when asked "Cache this password?"
   ```
2. Register the task:
   ```powershell
   # Default: weekly, Wednesday 09:00 local time.
   npm run job:discover:schedule

   # Or customise (npm forwards args after `--`):
   npm run job:discover:schedule -- -Frequency Daily -Time 08:30
   npm run job:discover:schedule -- -DaysOfWeek Tuesday,Friday -Time 10:00

   # Register and run once now for verification:
   npm run job:discover:schedule -- -RunNow
   ```
3. Remove the schedule later:
   ```powershell
   npm run job:discover:schedule:remove
   ```

### Task configuration

| Property | Value |
|---|---|
| Task name | `MaliScope Remote Discovery` (under `\MaliScope\`) |
| Runs as | Current Windows user, `LogonType Interactive` |
| Windows password stored | **No** — Interactive logon type never asks for it |
| Trigger | Weekly Wednesday 09:00 by default (`-Frequency`, `-Time`, `-DaysOfWeek`) |
| Action | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\run-remote-discovery.ps1 -NonInteractive` |
| Working dir | Repo root |
| Battery | Allowed to start and to keep running on battery |
| Missed runs | `StartWhenAvailable` — runs on next logon after a missed slot |
| Timeout | 15 minutes |
| Retries | 2 attempts, 10-minute gap |
| Concurrent instances | New instances ignored while one is already running |

Because the task uses `LogonType Interactive`, it only fires when your account
is logged on. That is exactly the constraint that lets DPAPI decrypt the
cached password. If you want it to run without you being logged in you would
need to store your Windows password in Task Scheduler — this script
deliberately does not do that.

### Where the logs go

Every scheduled run appends a full PowerShell transcript to:

```
%LOCALAPPDATA%\MaliScope\logs\remote-discovery-YYYY-MM-DD.log
```

Tail today's log while a scheduled run is happening:

```powershell
Get-Content "$env:LOCALAPPDATA\MaliScope\logs\remote-discovery-$(Get-Date -Format yyyy-MM-dd).log" -Wait -Tail 40
```

### Verifying a scheduled run

```powershell
# In Task Scheduler UI: Task Scheduler Library > MaliScope > MaliScope Remote Discovery
# Or from PowerShell:
Get-ScheduledTaskInfo -TaskName "MaliScope Remote Discovery" -TaskPath "\MaliScope\"
```

`LastTaskResult`:
- `0` — success.
- `2` — DPAPI cache missing; populate it and try again.
- non-zero — the `job:discover` script itself failed; check the transcript log.

### Common issues with the schedule

- **Task shows "Ready" but never runs.** Laptop was asleep at trigger time
  and hasn't been unlocked since the missed slot. `StartWhenAvailable`
  should pick it up on next logon; if it doesn't, right-click the task in
  Task Scheduler and choose "Run".
- **`LastTaskResult` is 2.** The DPAPI cache was wiped (e.g. Windows profile
  change). Re-run `npm run job:discover:remote` interactively once and
  answer `y` to the cache prompt.
- **Task runs but nothing lands in the DB.** Read the transcript log —
  usually a stale cached password. Rotate with
  `npm run job:discover:remote -- -ResetPassword`.

## Failure modes

### `Postgres is not published to 127.0.0.1:5433 on the VM.`

You skipped the one-time VM step. Re-run:

```bash
cd ~/apps/maliscope && git pull && docker compose up -d postgres
```

### `SSH tunnel process exited before the port became ready`

Usually one of:

- SSH key not loaded or wrong path — try `ssh stockup@2.28.75.21 whoami` first.
- Port `55432` already bound on the laptop by another tunnel or process. Pick
  a different one:
  ```powershell
  npm run job:discover:remote -- -LocalPort 55433
  ```
  (npm forwards args after `--` to the script.)
- The VM's SSH server refused the forward. Check
  `~/.ssh/config` on the VM has no `AllowTcpForwarding no`.

### `password authentication failed for user "maliscope"`

Wrong password (either what you typed, or a stale cached value). Rotate:

```powershell
npm run job:discover:remote -- -ResetPassword
```

Refetch the current value from the VM if you don't remember it:

```powershell
ssh stockup@2.28.75.21 "grep '^PGPASSWORD=' ~/apps/maliscope/.env"
```

Copy the value **after** the `=`, without quotes.

### A source still 403s in the result JSON

Cloudflare or Imperva is now flagging your residential IP too — usually
because you've run the crawler too many times in a row from the same address.
Wait an hour, or run from a different network. If it keeps failing, that
source needs partner-side allowlisting; this runbook can't work around it.

### The script says "completed" but no cards appear on `/discovery`

Confirm you were pointed at the production DB, not a local one:

```powershell
# While the script is running, in another PowerShell:
Test-NetConnection 127.0.0.1 -Port 55432
```

Should be `TcpTestSucceeded: True`. Also check `job_runs.payload` on the VM —
each per-source result includes `imported` counts.

## Security notes

- The tunnel binds `127.0.0.1:55432` on the laptop and `127.0.0.1:5433` on the
  VM. Neither side listens on a public interface. UFW rules are untouched.
- The `PGPASSWORD` prompt uses `Read-Host -AsSecureString`. The plaintext is
  materialised only long enough to build the `DATABASE_URL` env var and is
  cleared in the `finally` block, including on Ctrl+C.
- The cached password at `%LOCALAPPDATA%\MaliScope\pg-password.dpapi` is
  DPAPI-encrypted at user + machine scope. The file cannot be decrypted on
  another PC or by another Windows account, even with local admin. The script
  additionally strips inheritance and grants read/write to your SID only.
- The script does not write the plaintext password or `DATABASE_URL` to disk
  or logs.
- The endpoint targeted (`/api/discovery`) is not involved — this flow bypasses
  the HTTP layer entirely and speaks Postgres directly through the tunnel.

## Rolling back

To stop supporting laptop-side crawls (e.g. if a partner finally allowlists the
VM):

1. On the VM, comment the `ports:` block under `postgres` in
   `docker-compose.yml`, then `docker compose up -d postgres`.
2. Remove `scripts/run-remote-discovery.ps1` and the `job:discover:remote`
   script from `package.json`.
3. Delete this file.
4. On each operator laptop, delete the cache:
   `Remove-Item "$env:LOCALAPPDATA\MaliScope\pg-password.dpapi"`.

No data migration needed — nothing in the data model is specific to the
laptop-run path.
