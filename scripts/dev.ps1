# Kaaj Local Development Orchestrator (PowerShell)
# Starts backend and UI servers, and terminates all child processes on Ctrl+C.

Write-Host "[kaaj] Starting API (http://localhost:3001) and Web UI (http://localhost:3000)..." -ForegroundColor Cyan
Write-Host "[kaaj] Press Ctrl+C to stop both servers." -ForegroundColor Gray

# Proactively clean up any lingering processes on ports 3000 and 3001
Get-NetTCPConnection -LocalPort 3000, 3001 -ErrorAction SilentlyContinue | ForEach-Object {
    taskkill /F /PID $_.OwningProcess 2>$null
}

$api = Start-Process bun -ArgumentList "run", "--filter", "@kaaj/api", "dev" -PassThru -NoNewWindow
$web = Start-Process bun -ArgumentList "run", "--filter", "@kaaj/web", "dev" -PassThru -NoNewWindow

function Stop-DevServers {
    Write-Host "`n[kaaj] Shutting down Kaaj services..." -ForegroundColor Yellow
    if ($api -and !$api.HasExited) {
        taskkill /F /T /PID $api.Id 2>$null
    }
    if ($web -and !$web.HasExited) {
        taskkill /F /T /PID $web.Id 2>$null
    }

    # Clean up any lingering processes on ports 3000 and 3001
    Get-NetTCPConnection -LocalPort 3000, 3001 -ErrorAction SilentlyContinue | ForEach-Object {
        taskkill /F /PID $_.OwningProcess 2>$null
    }

    Write-Host "[kaaj] All services stopped cleanly." -ForegroundColor Green
}

try {
    Wait-Process -Id $api.Id, $web.Id
}
finally {
    Stop-DevServers
}
