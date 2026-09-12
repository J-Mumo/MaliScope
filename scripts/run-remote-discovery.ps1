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
    1. Verify the VM publishes Postgres on 127.0.0.1:5433 (loopback only).
    2. Open  ssh -N -L $LocalPort:127.0.0.1:5433 $SshTarget  as a background
       process.
    3. Wait for the tunnel to accept connections.
    4. Set DATABASE_URL to point at the tunnel and run `npm run job:discover`.
    5. Close the tunnel and clear DATABASE_URL on exit (even on Ctrl+C).

.PARAMETER SshTarget
  user@host for the deployment VM. Default matches the Hetzner deployment.

.PARAMETER LocalPort
  Local port to bind the tunnel to. Default 55432 to avoid colliding with the
  Docker Compose dev Postgres on 5433.

.PARAMETER Database
  Postgres database name. Default matches .env.production.example.

.PARAMETER User
  Postgres role. Default matches .env.production.example.

.EXAMPLE
  ./scripts/run-remote-discovery.ps1

.EXAMPLE
  ./scripts/run-remote-discovery.ps1 -SshTarget stockup@2.28.75.21 -LocalPort 55432
#>
[CmdletBinding()]
param(
    [string]$SshTarget = "stockup@2.28.75.21",
    [int]$LocalPort = 55432,
    [int]$RemotePort = 5433,
    [string]$Database = "maliscope",
    [string]$User = "maliscope"
)

$ErrorActionPreference = "Stop"

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

$pgSecure = Read-Host -AsSecureString -Prompt "PGPASSWORD (find with: ssh $SshTarget 'grep PGPASSWORD ~/apps/maliscope/.env')"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSecure)
try {
    $pgPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

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
} finally {
    if ($tunnel -and -not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $pgPassword = $null
    [GC]::Collect()
    Write-Host "Tunnel closed." -ForegroundColor Cyan
}

if ($exitCode -ne 0) { exit $exitCode }
