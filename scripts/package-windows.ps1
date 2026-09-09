param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$PlaywrightCore
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$releaseRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $releaseRoot) { throw 'Use a new destination directory for each release.' }
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'app') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'automation/node_modules') -Force | Out-Null
$assets = @{
  'public/shell.html'='shell.html'; 'public/shell.css'='shell.css'; 'public/editor-bridge.js'='editor-bridge.js';
  'public/library-panel.js'='library-panel.js';
  'public/character-workflow.js'='character-workflow.js'; 'public/character-panel.js'='character-panel.js';
  'static/index.html'='index.html'; 'static/app.js'='app.js'; 'app/globals.css'='style.css';
  'public/video-import.js'='video-import.js'; 'public/favicon.svg'='favicon.svg'; 'public/og.png'='og.png'
}
foreach($entry in $assets.GetEnumerator()) { Copy-Item -LiteralPath (Join-Path $sourceRoot $entry.Key) -Destination (Join-Path $releaseRoot ('app/' + $entry.Value)) }
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'automation') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $releaseRoot 'automation') }
Copy-Item -LiteralPath $PlaywrightCore -Destination (Join-Path $releaseRoot 'automation/node_modules/playwright-core') -Recurse
foreach($name in @('CHECKPOINT.md','AUDIT-AND-PLAN.md','CHANGELOG.md','CONNECTIONS-SETUP.md','SHELL-REDESIGN.md','STARTUP-RECOVERY.md','VERSION')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $releaseRoot }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'desktop/SPRITED-Library.cmd') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot 'LIBRARY-GUIDE.md') -Destination $releaseRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe "/out:$releaseRoot/SPRITED-Advanced.exe" /reference:System.Windows.Forms.dll (Join-Path $sourceRoot 'desktop/SpritedLauncher.cs')
if($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed.' }
& $compiler /nologo /target:winexe "/out:$releaseRoot/SPRITED.exe" /reference:System.Windows.Forms.dll (Join-Path $sourceRoot 'desktop/ProductLauncher.cs')
if($LASTEXITCODE -ne 0) { throw 'Product launcher compilation failed.' }
Write-Output "Packaged $releaseRoot"
