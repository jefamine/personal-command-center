$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Test-DashboardServer {
    try {
        return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4173" -TimeoutSec 1).StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw "Failed to install local dependencies." }
}

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Failed to build the dashboard." }

$isRunning = Test-DashboardServer
$serverProcess = $null

if (-not $isRunning) {
    $serverProcess = Start-Process `
        -FilePath "node.exe" `
        -ArgumentList "scripts/local-server.mjs" `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -PassThru

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 250
        $isRunning = Test-DashboardServer
        if ($serverProcess.HasExited) { break }
    } while (-not $isRunning -and (Get-Date) -lt $deadline)
}

if (-not $isRunning) {
    if ($serverProcess -and $serverProcess.HasExited) {
        throw "Local dashboard server exited with code $($serverProcess.ExitCode)."
    }
    throw "Local dashboard server did not start on http://127.0.0.1:4173."
}

if ($env:DASHBOARD_NO_BROWSER -ne "1") {
    Start-Process "http://127.0.0.1:4173"
}
