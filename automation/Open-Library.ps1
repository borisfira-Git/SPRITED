param([string]$DataDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SPRITED'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
$libraryLog = Join-Path $DataDirectory 'library-server.log'
$errorLog = Join-Path $DataDirectory 'library-server-errors.log'
function Get-LibraryUrl {
  if (Test-Path -LiteralPath $libraryLog) {
    $line = Get-Content -LiteralPath $libraryLog | Where-Object { $_ -like 'Library: http://127.0.0.1:*' } | Select-Object -Last 1
    if ($line) { return $line.Substring(9) }
  }
}
$existingUrl = Get-LibraryUrl
$liveServer = $false
if ($existingUrl) {
  try {
    $parts = $existingUrl.Split('#')
    $statusUrl = $parts[0].Replace('/ui/', '/status')
    $null = Invoke-RestMethod -Uri $statusUrl -Headers @{ Authorization = ('Bearer ' + $parts[1]) } -TimeoutSec 2
    $liveServer = $true
  } catch { }
}
if ($liveServer) {
  $sameRelease = $false
  try {
    $setupUrl = $parts[0].Replace('/ui/', '/connections/setup')
    $setup = Invoke-RestMethod -Uri $setupUrl -Headers @{ Authorization = ('Bearer ' + $parts[1]) } -TimeoutSec 2
    $sameRelease = [IO.Path]::GetFullPath($setup.result.cli_path) -eq [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'cli.mjs'))
  } catch { }
  if (-not $sameRelease) {
    throw 'An older or different SPRITED Library server is still running. Restart Windows, then open SPRITED-Library.cmd from this release. Your saved library stays in place. See CONNECTIONS-SETUP.md.'
  }
  Start-Process $existingUrl
  exit
}
$node = (Get-Command node -ErrorAction Stop).Source
$cli = Join-Path $PSScriptRoot 'cli.mjs'
$arguments = '"' + $cli + '" serve --workspace "' + [IO.Path]::GetFullPath($DataDirectory) + '"'
Start-Process -FilePath $node -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $libraryLog -RedirectStandardError $errorLog
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  $libraryUrl = Get-LibraryUrl
  if ($libraryUrl) { Start-Process $libraryUrl; exit }
}
throw "Library server did not start. Check $errorLog. Node.js and Microsoft Edge are required."
