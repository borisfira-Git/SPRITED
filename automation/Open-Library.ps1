param([string]$DataDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SPRITED'), [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$launchMutex = $null
$mutexOwned = $false
try {
  $DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
  New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
  $libraryLog = Join-Path $DataDirectory 'library-server.log'
  $errorLog = Join-Path $DataDirectory 'library-server-errors.log'
  $startupLog = Join-Path $DataDirectory 'startup.log'
  $lockPath = Join-Path $DataDirectory '.sprited/automation.lock'
  $expectedCli = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'cli.mjs'))
  $obsoleteSpritedPid = $null
  function Trace-Startup($EventName, $Details) {
    $record = @{ time = [DateTime]::UtcNow.ToString('o'); event = $EventName; lock_path = $lockPath; details = $Details }
    Add-Content -LiteralPath $startupLog -Value ($record | ConvertTo-Json -Compress -Depth 5) -Encoding UTF8
  }
  # The named OS mutex disappears when its owner exits: no second stale sentinel file.
  $hasher = [Security.Cryptography.SHA256]::Create()
  $key = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($DataDirectory.ToLowerInvariant()))).Replace('-', '')
  $hasher.Dispose()
  $launchMutex = New-Object Threading.Mutex($false, ('Local\SPRITED-start-' + $key))
  try { $mutexOwned = $launchMutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $mutexOwned = $true }
  if (-not $mutexOwned) { throw 'Another SPRITED launch is still starting. Please wait a moment and try again.' }
  function Get-LibraryUrl {
    if (Test-Path -LiteralPath $libraryLog) {
      $line = Get-Content -LiteralPath $libraryLog | Where-Object { $_ -like 'Library: http://127.0.0.1:*' } | Select-Object -Last 1
      if ($line) { return $line.Substring(9) }
    }
  }
  function Test-LibraryServer([string]$Candidate) {
    if (-not $Candidate) { return $false }
    try {
      $uri = [Uri]$Candidate
      if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.AbsolutePath -ne '/ui/' -or -not $uri.Fragment) { return $false }
      $owners = @()
      try { $owners = @(Get-NetTCPConnection -LocalPort $uri.Port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique) } catch {
        $portPattern = '^\s*TCP\s+\S+:' + $uri.Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
        $owners = @(& netstat.exe -ano -p tcp | ForEach-Object { if ($_ -match $portPattern) { [int]$matches[1] } } | Select-Object -Unique)
        Trace-Startup 'port-inspection-fallback' @{ method = 'netstat'; port = $uri.Port }
      }
      Trace-Startup 'port-inspected' @{ port = $uri.Port; port_owner = $owners }
      if ($owners.Count -ne 1) { return $false }
      $ownerProcess = Get-Process -Id ([int]$owners[0]) -ErrorAction SilentlyContinue
      $ownerCommand = $null
      try { $ownerCommand = (Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$owners[0]) -ErrorAction Stop).CommandLine } catch { }
      Trace-Startup 'process-inspected' @{ pid = $owners[0]; process_exists = [bool]$ownerProcess; executable = $ownerProcess.Path }
      if (-not $ownerProcess -or $ownerProcess.ProcessName -ne 'node') { return $false }
      $headers = @{ Authorization = ('Bearer ' + $uri.Fragment.Substring(1)) }
      $origin = $uri.GetLeftPart([UriPartial]::Authority)
      $identity = $null
      try { $identity = Invoke-RestMethod -Uri ($origin + '/identity') -Headers $headers -TimeoutSec 3 } catch { }
      if ($identity -and $identity.application -eq 'SPRITED' -and [int]$identity.pid -eq [int]$owners[0] -and [IO.Path]::GetFullPath($identity.workspace) -eq $DataDirectory) {
        $serverCli = [IO.Path]::GetFullPath($identity.cli_path)
      } else {
        # Older SPRITED releases: require its authenticated setup AND matching lock PID.
        $setup = Invoke-RestMethod -Uri ($origin + '/connections/setup') -Headers $headers -TimeoutSec 3
        if (-not $setup.success -or -not $setup.result.cli_path -or -not (Test-Path -LiteralPath $lockPath)) { return $false }
        $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
        $lockOwner = if ($lock -is [ValueType]) { [int]$lock } else { [int]$lock.pid }
        if ($lockOwner -ne [int]$owners[0]) { return $false }
        $serverCli = [IO.Path]::GetFullPath($setup.result.cli_path)
      }
      if ([IO.Path]::GetFileName($serverCli) -ne 'cli.mjs' -or [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($serverCli)) -ne 'automation') { return $false }
      if ($ownerCommand) {
        $commandLine = $ownerCommand.Replace('/', '\')
        if ($commandLine.IndexOf($serverCli.Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
        if ($commandLine -notmatch '\sserve(?:\s|$)') { return $false }
      } else {
        if (-not (Test-Path -LiteralPath $serverCli)) { return $false }
        Trace-Startup 'process-commandline-unavailable' @{ pid = $owners[0]; verification = 'authenticated SPRITED identity/setup plus workspace/lock and actual port owner; never executable name alone' }
      }
      if (-not [String]::Equals($serverCli, $expectedCli, [StringComparison]::OrdinalIgnoreCase)) {
        $script:obsoleteSpritedPid = [int]$owners[0]
        Trace-Startup 'obsolete-SPRITED-runtime' @{ pid = $owners[0]; running_cli_path = $serverCli; expected_cli_path = $expectedCli; cleanup = 'stop only the authenticated SPRITED server for this workspace, then start this package runtime' }
        return $false
      }
      Trace-Startup 'verified-SPRITED-server' @{ pid = $owners[0]; executable = $ownerProcess.Path; port = $uri.Port; cli_path = $serverCli; cleanup = 'none; reconnect to verified running server' }
      return $true
    } catch { Trace-Startup 'server-marker-not-verified' @{ cleanup = 'ignore marker; do not stop any process' }; return $false }
  }
  $existingUrl = Get-LibraryUrl
  if (Test-LibraryServer $existingUrl) {
    if (-not $NoOpen) { Start-Process $existingUrl }
    Write-Output ('SPRITED_STARTUP_OK: reconnected')
    exit 0
  }
  if ($obsoleteSpritedPid) {
    Stop-Process -Id $obsoleteSpritedPid -Force -ErrorAction Stop
    for ($wait = 0; $wait -lt 50 -and (Get-Process -Id $obsoleteSpritedPid -ErrorAction SilentlyContinue); $wait++) { Start-Sleep -Milliseconds 100 }
    if (Get-Process -Id $obsoleteSpritedPid -ErrorAction SilentlyContinue) { throw 'An older SPRITED runtime could not be stopped safely.' }
    Trace-Startup 'obsolete-SPRITED-runtime-stopped' @{ pid = $obsoleteSpritedPid; cleanup = 'old server stopped; library data preserved' }
  }
  Trace-Startup 'starting-service' @{ cleanup = 'ignore stale URL marker; service will validate lock owner'; port = 'OS-selected free localhost port' }
  $bundleRoot = Split-Path $PSScriptRoot -Parent
  $bundledNode = Join-Path $bundleRoot 'runtime\node.exe'
  $node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
  Trace-Startup 'runtime-selected' @{ executable = $node; bundled = (Test-Path -LiteralPath $bundledNode) }
  $cli = $expectedCli
  $spawnHelper = Join-Path $PSScriptRoot 'spawn-service.mjs'
  $childId = & $node $spawnHelper $DataDirectory
  if ($LASTEXITCODE -ne 0 -or $childId -notmatch '^\d+$') { throw 'Could not launch the local service. See startup.log.' }
  $child = Get-Process -Id ([int]$childId) -ErrorAction Stop
  Trace-Startup 'service-spawned' @{ pid = $child.Id; executable = $node }
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    $child.Refresh()
    if ($child.HasExited) { throw 'The local service could not start. See startup.log and library-server-errors.log in your library folder. Your library data is unchanged.' }
    $libraryUrl = Get-LibraryUrl
    if ($libraryUrl -and (Test-LibraryServer $libraryUrl)) {
      if (-not $NoOpen) { Start-Process $libraryUrl }
      Write-Output 'SPRITED_STARTUP_OK: started'
      exit 0
    }
  }
  throw 'SPRITED is taking longer than expected to start. Try opening it again; see startup.log for details.'
} catch {
  if ($startupLog) { Trace-Startup 'startup-failed' @{ message = $_.Exception.Message; cleanup = 'no library data removed' } }
  [Console]::Error.WriteLine('SPRITED_STARTUP_ERROR: Could not open the local workspace. See startup.log in your library folder for details. Your saved library has not been deleted.')
  exit 1
} finally {
  if ($mutexOwned) { $launchMutex.ReleaseMutex() }
  if ($launchMutex) { $launchMutex.Dispose() }
}
