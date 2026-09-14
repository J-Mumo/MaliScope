<#
.SYNOPSIS
  Run the MaliScope discovery job on this machine against the production
  Postgres over an SSH tunnel.

.DESCRIPTION
  Some source sites (Jiji, PropertyPro, BuyRentKenya, ...) sit behind
  Cloudflare and 403 requests from the Hetzner VM's IP range while serving
  200 to residential IPs. This script lets an operator crawl from their
  laptop (residential IP) and persist drafts directly into the production
  database.

  Flow:
    1. Load PGPASSWORD from the DPAPI-encrypted cache, or prompt for it.
    2. Verify the VM publishes Postgres on 127.0.0.1:5433 (loopback only).
    3. Open  ssh -N -L $LocalPort:127.0.0.1:5433 $SshTarget  as a background
       process.
    4. Wait for the tunnel to accept connections.
    5. Set DATABASE_URL to point at the tunnel and run `npm run job:discover`.
    6. Close the tunnel and clear DATABASE_URL on exit (even on Ctrl+C).

  Password cache
    Stored at %LOCALAPPDATA%\MaliScope\pg-password.dpapi, encrypted with the
    Windows Data Protection API (DPAPI). Only your Windows user account on
    this machine can decrypt it. Copying the file to another PC or another
    account makes it unreadable.

.PARAMETER SshTarget
  user@host for the deployment VM. Default matches the Hetzner deployment.

.PARAMETER LocalPort
  Local port to bind the tunnel to. Default 55432 to avoid colliding with the
  Docker Compose dev Postgres on 5433.

.PARAMETER Database
  Postgres database name. Default matches .env.production.example.

.PARAMETER User
  Postgres role. Default matches .env.production.example.

.PARAMETER ResetPassword
  Delete any cached password before running. You will be prompted, and the new
  value will be offered for re-caching.

.PARAMETER NonInteractive
  Skip every prompt and require the DPAPI cache to already exist. Intended for
  Windows Task Scheduler. Also mirrors console output to a dated log file in
  %LOCALAPPDATA%\MaliScope\logs\.

.EXAMPLE
  # Normal run - uses cached password if present, prompts otherwise.
  ./scripts/run-remote-discovery.ps1

.EXAMPLE
  # Rotate the cached password (e.g. after PGPASSWORD changed on the VM).
  ./scripts/run-remote-discovery.ps1 -ResetPassword

.EXAMPLE
  # What Task Scheduler runs. Fails immediately if the cache is missing.
  ./scripts/run-remote-discovery.ps1 -NonInteractive
#>
[CmdletBinding()]
param(
    [string]$SshTarget = "stockup@2.28.75.21",
    [int]$LocalPort = 55432,
    [int]$RemotePort = 5433,
    [string]$Database = "maliscope",
    [string]$User = "maliscope",
    [switch]$ResetPassword,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

# ---------- Log transcript when running unattended --------------------------

$transcriptStarted = $false
if ($NonInteractive) {
    $logDir = Join-Path $env:LOCALAPPDATA "MaliScope\logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $logFile = Join-Path $logDir ("remote-discovery-{0:yyyy-MM-dd}.log" -f (Get-Date))
    Start-Transcript -Path $logFile -Append | Out-Null
    $transcriptStarted = $true
    Write-Host "==== $(Get-Date -Format o) MaliScope remote discovery (scheduled) ===="
}

# ---------- Password cache (DPAPI) ------------------------------------------

$passwordDir  = Join-Path $env:LOCALAPPDATA "MaliScope"
$passwordFile = Join-Path $passwordDir "pg-password.dpapi"

function Get-CachedPgPassword {
    if (-not (Test-Path -LiteralPath $passwordFile)) { return $null }
    try {
        $encrypted = Get-Content -LiteralPath $passwordFile -Raw -ErrorAction Stop
        # ConvertTo-SecureString without -Key uses DPAPI. Fails if the file
        # was written by a different Windows account or on a different PC.
        return ConvertTo-SecureString -String $encrypted.Trim() -ErrorAction Stop
    } catch {
        Write-Warning "Could not decrypt cached password ($($_.Exception.Message)). Will prompt."
        return $null
    }
}

function Set-CachedPgPassword {
    param([Parameter(Mandatory)][securestring]$Secure)
    if (-not (Test-Path -LiteralPath $passwordDir)) {
        New-Item -ItemType Directory -Path $passwordDir -Force | Out-Null
    }
    $encrypted = ConvertFrom-SecureString -SecureString $Secure  # DPAPI, user+machine scope
    Set-Content -LiteralPath $passwordFile -Value $encrypted -Encoding ASCII -NoNewline
    # Clamp ACL to this user only. Belt-and-braces on top of DPAPI.
    try {
        $acl = Get-Acl -LiteralPath $passwordFile
        $acl.SetAccessRuleProtection($true, $false)   # disable inheritance
        $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
            "FullControl", "Allow"
        )
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $passwordFile -AclObject $acl
    } catch {
        Write-Verbose "ACL hardening skipped: $($_.Exception.Message)"
    }
    Write-Host "Password cached at $passwordFile (DPAPI, this user + this machine only)." -ForegroundColor DarkGray
}

if ($ResetPassword -and (Test-Path -LiteralPath $passwordFile)) {
    Remove-Item -LiteralPath $passwordFile -Force
    Write-Host "Removed cached password. You will be prompted." -ForegroundColor Yellow
}

# ---------- Preflight -------------------------------------------------------

Write-Host "Verifying Postgres is published on the VM loopback..." -ForegroundColor Cyan
$portCheck = ssh $SshTarget "docker port maliscope-postgres-1 5432/tcp 2>/dev/null"
if (-not ($portCheck -match "127\.0\.0\.1:$RemotePort")) {
    Write-Error @"
Postgres is not published to 127.0.0.1:$RemotePort on the VM.

Fix on the VM:
  cd ~/apps/maliscope
  git pull                        # picks up the updated docker-compose.yml
  docker compose up -d postgres   # re-creates postgres with the new ports block

Then re-run this script.
"@
    exit 1
}

# ---------- Resolve password ------------------------------------------------

$pgSecure = Get-CachedPgPassword
$fromCache = $null -ne $pgSecure

if (-not $fromCache) {
    if ($NonInteractive) {
        Write-Error "No cached PGPASSWORD found at $passwordFile. Run 'npm run job:discover:remote' once interactively to populate the cache before scheduling."
        exit 2
    }
    $pgSecure = Read-Host -AsSecureString -Prompt "PGPASSWORD (find with: ssh $SshTarget 'grep PGPASSWORD ~/apps/maliscope/.env')"
    $answer = Read-Host "Cache this password for future runs? (encrypted with your Windows account) [y/N]"
    if ($answer -match '^(y|yes)$') {
        Set-CachedPgPassword -Secure $pgSecure
    }
} else {
    Write-Host "Using cached PGPASSWORD from $passwordFile." -ForegroundColor DarkGray
}

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSecure)
try {
    $pgPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# ---------- Tunnel + job ----------------------------------------------------

Write-Host "Opening SSH tunnel 127.0.0.1:$LocalPort -> $SshTarget -> 127.0.0.1:$RemotePort ..." -ForegroundColor Cyan
$tunnel = Start-Process ssh -ArgumentList @(
    "-N",
    "-L", "${LocalPort}:127.0.0.1:${RemotePort}",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    $SshTarget
) -PassThru -WindowStyle Hidden

try {
    # Wait for the forwarded port to accept a TCP connection.
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if ($tunnel.HasExited) {
            throw "SSH tunnel process exited before the port became ready (exit code $($tunnel.ExitCode))."
        }
        try {
            $sock = New-Object System.Net.Sockets.TcpClient
            $sock.Connect("127.0.0.1", $LocalPort)
            $sock.Close()
            $ready = $true
            break
        } catch { }
    }
    if (-not $ready) { throw "Tunnel never opened on 127.0.0.1:$LocalPort" }

    # URL-encode the password so special chars survive the DATABASE_URL parse.
    $encoded = [uri]::EscapeDataString($pgPassword)
    $env:DATABASE_URL = "postgresql://${User}:${encoded}@127.0.0.1:${LocalPort}/${Database}"

    Write-Host ""
    Write-Host "Running npm run job:discover against production DB via tunnel..." -ForegroundColor Green
    Write-Host ""
    npm run job:discover
    $exitCode = $LASTEXITCODE

    # If the DB rejected the cached password, invite the operator to reset it.
    if ($fromCache -and $exitCode -ne 0) {
        Write-Warning "Job exited non-zero. If this was 'password authentication failed', re-run with -ResetPassword."
    }
} finally {
    if ($tunnel -and -not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $pgPassword = $null
    [GC]::Collect()
    Write-Host "Tunnel closed." -ForegroundColor Cyan
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}

if ($exitCode -ne 0) { exit $exitCode }
