param([Parameter(ValueFromRemainingArguments=$true)][string[]]$StartupArgs)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$sharedRoot = $repoRoot
$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$gitPath = if ($gitCommand) { $gitCommand.Source } else { Join-Path $env:ProgramFiles 'Git\cmd\git.exe' }
if (Test-Path $gitPath) {
    $common = & $gitPath -C $repoRoot rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $common) { $sharedRoot = Split-Path $common -Parent }
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$candidates = @(
    (Join-Path $repoRoot '.local\tools\node-v22.23.3-win-x64\node.exe'),
    (Join-Path $sharedRoot '.local\tools\node-v22.23.3-win-x64\node.exe')
)
if ($nodeCommand) { $candidates += $nodeCommand.Source }
$nodePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $nodePath) { throw 'Install Node 22.18 or later, then run Start-Tassel.cmd again.' }
& $nodePath (Join-Path $PSScriptRoot 'start.mjs') @StartupArgs
exit $LASTEXITCODE
