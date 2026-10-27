# TGTI AI Office: installer for Windows.
# Run in PowerShell:  irm https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/windows/install.ps1 | iex
# What it does (no admin rights needed):
#   1. copies the office into %LOCALAPPDATA%\TGTI-AI-Office;
#   2. uses Node.js if it is installed, otherwise downloads a private copy of Node.js LTS into that folder;
#   3. adds the hooks for Claude Code and Codex;
#   4. adds the wallpaper to Wallpaper Engine (tab "Installed");
#   5. adds a hidden task: the server runs only while Wallpaper Engine is open and closes with it.
# Running it again updates everything. Uninstall: windows\uninstall.ps1 (see README).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'AlexanderGrandees/thegrandees-ai-office'
$App = Join-Path $env:LOCALAPPDATA 'TGTI-AI-Office'
$Task = 'TGTI AI Office'
function Say($t) { Write-Host "  $t" }
function Step($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
Write-Host "`nTGTI AI Office: installing" -ForegroundColor Magenta
$fresh = -not (Test-Path "$App\version.txt")   # first install on this PC (updates rerun this script)

# 1. files
Step 'Downloading the office'
$tmp = Join-Path $env:TEMP ('tgti-office-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
if ($env:TGTI_SOURCE) { $src = $env:TGTI_SOURCE; Say "local source: $src" }
else {
  Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile "$tmp\src.zip"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory("$tmp\src.zip", "$tmp\src")
  $src = (Get-ChildItem "$tmp\src" -Directory | Select-Object -First 1).FullName
}

# an old server (from a previous install or a Desktop copy) must stop before files are replaced
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*office-server.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $App | Out-Null
foreach ($f in 'index.html', 'project.json', 'office-server.mjs', 'hook.mjs', 'install-hooks.mjs', 'test-agent.mjs', 'LICENSE') {
  Copy-Item (Join-Path $src $f) $App -Force
}
Copy-Item (Join-Path $src 'fonts') $App -Recurse -Force
Copy-Item (Join-Path $src 'windows\watch.vbs') $App -Force
Copy-Item (Join-Path $src 'windows\uninstall.ps1') $App -Force
Copy-Item (Join-Path $src 'windows\update.vbs') $App -Force
Copy-Item (Join-Path $src 'windows\update.ps1') $App -Force
Copy-Item (Join-Path $src 'docs\preview.jpg') $App -Force
Say "installed into $App"

# 2. Node.js
Step 'Checking Node.js'
function NodeOk($exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  try { $v = (& $exe -v) 2>$null; return ([int]($v -replace '^v(\d+).*', '$1')) -ge 18 } catch { return $false }
}
$node = $null
$cands = @()
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $cands += $cmd.Source }
$cands += "$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe", "$App\node\node.exe"
if (-not $env:TGTI_FORCE_PORTABLE_NODE) { foreach ($c in $cands) { if (NodeOk $c) { $node = $c; break } } }
if ($node) { Say "using $node ($(& $node -v))" }
else {
  Say 'Node.js not found: downloading a private copy of Node.js LTS (about 30 MB)'
  $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1
  $arch = 'x64'; if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $name = "node-$($lts.version)-win-$arch"
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($lts.version)/$name.zip" -OutFile "$tmp\node.zip"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory("$tmp\node.zip", "$tmp\node")
  if (Test-Path "$App\node") { Remove-Item "$App\node" -Recurse -Force }
  Move-Item "$tmp\node\$name" "$App\node"
  $node = "$App\node\node.exe"
  Say "Node.js $($lts.version) is in $App\node (only for the office, PATH is not changed)"
}
Set-Content -Path "$App\node-path.txt" -Value $node -Encoding Unicode

# version for the automatic updates (the server checks GitHub twice a day and reruns this installer quietly)
$ver = 'local'
if (-not $env:TGTI_SOURCE) {
  try {
    $refs = (Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo.git/info/refs?service=git-upload-pack").Content
    if ($refs -is [byte[]]) { $refs = [Text.Encoding]::ASCII.GetString($refs) }
    $m = [regex]::Match($refs, '([0-9a-f]{40}) refs/heads/main'); if ($m.Success) { $ver = $m.Groups[1].Value }
  } catch { }
}
elseif (Test-Path (Join-Path $src 'VERSION')) { $ver = (Get-Content (Join-Path $src 'VERSION') | Select-Object -First 1).Trim() }
Set-Content -Path "$App\version.txt" -Value $ver -Encoding Ascii

# 3. hooks
Step 'Adding hooks for Claude Code and Codex'
Push-Location $App
& $node install-hooks.mjs | ForEach-Object { Say $_ }
Pop-Location

# 4. Wallpaper Engine
Step 'Adding the wallpaper to Wallpaper Engine'
function Find-WE {
  $c = @()
  Get-Process wallpaper32, wallpaper64 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $c += Split-Path $_.Path } }
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  if ($steam) {
    $c += Join-Path $steam 'steamapps\common\wallpaper_engine'
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) {
      Select-String -Path $vdf -Pattern '"path"\s+"(.+?)"' | ForEach-Object {
        $c += Join-Path ($_.Matches[0].Groups[1].Value -replace '\\\\', '\') 'steamapps\common\wallpaper_engine'
      }
    }
  }
  $c += "${env:ProgramFiles(x86)}\Steam\steamapps\common\wallpaper_engine", "$env:ProgramFiles\Steam\steamapps\common\wallpaper_engine"
  if ($env:TGTI_WE_DIR) { $c = @($env:TGTI_WE_DIR) + $c }
  foreach ($d in $c) { if ($d -and (Test-Path (Join-Path $d 'projects'))) { return $d } }
  return $null
}
$we = Find-WE
$wall = $null
if ($we) {
  $wall = Join-Path $we 'projects\myprojects\tgti-ai-office'
  try {
    New-Item -ItemType Directory -Force -Path $wall | Out-Null
    # keep the Steam Workshop id that Wallpaper Engine wrote after publishing, so updates go to the same Workshop item
    $wsid = $null
    if (Test-Path "$wall\project.json") {
      $m = [regex]::Match([IO.File]::ReadAllText("$wall\project.json"), '"workshopid"\s*:\s*"?(\d+)"?')
      if ($m.Success) { $wsid = $m.Groups[1].Value }
    }
    foreach ($f in 'index.html', 'project.json', 'preview.jpg') { Copy-Item "$App\$f" $wall -Force }
    if ($wsid) {
      $pj = [IO.File]::ReadAllText("$wall\project.json")
      $pj = $pj.Substring(0, $pj.IndexOf('{') + 1) + "`n  `"workshopid`": `"$wsid`"," + $pj.Substring($pj.IndexOf('{') + 1)
      [IO.File]::WriteAllText("$wall\project.json", $pj, (New-Object Text.UTF8Encoding $false))
      Say "kept Steam Workshop id $wsid"
    }
    Copy-Item "$App\fonts" $wall -Recurse -Force
    Set-Content -Path "$App\we-path.txt" -Value $wall -Encoding Unicode
    Say "added: $wall"
  } catch { Say "could not write into $wall ($($_.Exception.Message))"; $wall = $null }
} else { Say 'Wallpaper Engine not found.' }
if (-not $wall) { Say "In Wallpaper Engine: Open wallpaper > Open from file > $App\index.html" }

# 5. hidden task: every minute it checks whether Wallpaper Engine is open and starts the server if needed
Step 'Setting up the server start'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'AI Office server.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; Say 'removed the old autostart shortcut' }
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$App\watch.vbs`"" -WorkingDirectory $App
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(10) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -Hidden
$triggers = @($every)
try { $triggers += New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" } catch { }
try { Register-ScheduledTask -TaskName $Task -Action $action -Trigger $triggers -Settings $set -Description 'TGTI AI Office: starts the office server while Wallpaper Engine is open' -Force | Out-Null }
catch { Register-ScheduledTask -TaskName $Task -Action $action -Trigger $every -Settings $set -Description 'TGTI AI Office: starts the office server while Wallpaper Engine is open' -Force | Out-Null }
Say 'the server starts by itself while Wallpaper Engine is open and stops when it closes (no tray icon, no window)'
Start-Process wscript.exe -ArgumentList "`"$App\watch.vbs`"" -WorkingDirectory $App

# anonymous install counter: on the first install only, download a tiny empty file from GitHub; the author sees only its download count (nothing is sent)
if ($fresh -and -not $env:GITHUB_ACTIONS -and -not $env:TGTI_SOURCE) {   # fork: no counter request for local installs
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "https://github.com/$Repo/releases/download/stats/install-windows.txt" | Out-Null } catch { }
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`nDone." -ForegroundColor Green
Say 'Open Wallpaper Engine > Installed > "TheGrandees AI Office".'
Say 'If it is not in the list yet, restart Wallpaper Engine.'
Say 'Codex: open Codex, type /hooks and trust the AI-Office hooks once.'
Say "Uninstall: powershell -ExecutionPolicy Bypass -File `"$App\uninstall.ps1`""
