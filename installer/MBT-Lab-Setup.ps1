# MBT Lab for Windows: small installer. It downloads the official Electron runtime (checked against its published SHA-256)
# and the latest MBT Lab files from GitHub, so this file never needs to be rebuilt when the app changes.
# Run it with MBT-Lab-Setup.cmd. Add the word "uninstall" to remove MBT Lab.
param([string]$Action = 'install')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$ElectronVersion = '45.3.4'
$Raw = 'https://raw.githubusercontent.com/bogey2711-web/mbt-lab/main/'
$Dest = Join-Path $env:LOCALAPPDATA 'MBT Lab'
$Exe = Join-Path $Dest 'MBT Lab.exe'
$Desktop = [Environment]::GetFolderPath('Desktop')
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$Links = @((Join-Path $Desktop 'MBT Lab.lnk'), (Join-Path $StartMenu 'MBT Lab.lnk'))

function Stop-App { Get-Process -Name 'MBT Lab' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 800 }

if ($Action -eq 'uninstall') {
    Stop-App
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    foreach ($l in $Links) { if (Test-Path $l) { Remove-Item $l -Force } }
    Write-Host 'MBT Lab has been removed. (Saved settings stay in %APPDATA%\MBT Lab; delete that folder too if you want them gone.)'
    return
}

Write-Host 'MBT Lab installer'
Write-Host '-----------------'
$Tmp = Join-Path $env:TEMP ('mbtlab_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
    # 1. Electron runtime from the official GitHub release, verified against the published checksum list
    $zipName = "electron-v$ElectronVersion-win32-x64.zip"
    $base = "https://github.com/electron/electron/releases/download/v$ElectronVersion/"
    Write-Host "1/4  Downloading the Electron $ElectronVersion runtime (about 110 MB)..."
    Invoke-WebRequest -UseBasicParsing -Uri ($base + $zipName) -OutFile (Join-Path $Tmp $zipName)
    Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt') -OutFile (Join-Path $Tmp 'SHASUMS256.txt')
    $line = Get-Content (Join-Path $Tmp 'SHASUMS256.txt') | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
    if (-not $line) { throw 'The checksum list does not contain the runtime file.' }
    $want = ($line -split '\s+')[0].ToLower()
    $got = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $zipName)).Hash.ToLower()
    if ($want -ne $got) { throw 'The downloaded runtime does not match its published checksum. Nothing was installed.' }

    # 2. The latest MBT Lab files from the GitHub repository
    Write-Host '2/4  Downloading the latest MBT Lab from GitHub...'
    $app = Join-Path $Tmp 'appfiles'
    New-Item -ItemType Directory -Path (Join-Path $app 'app') | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri ($Raw + 'desktop/main.js') -OutFile (Join-Path $app 'main.js')
    Invoke-WebRequest -UseBasicParsing -Uri ($Raw + 'desktop/package.json') -OutFile (Join-Path $app 'package.json')
    Invoke-WebRequest -UseBasicParsing -Uri ($Raw + 'index.html') -OutFile (Join-Path $app 'app\index.html')
    Invoke-WebRequest -UseBasicParsing -Uri ($Raw + 'version.json') -OutFile (Join-Path $app 'app\version.json')
    $ver = Get-Content (Join-Path $app 'app\version.json') -Raw | ConvertFrom-Json
    $sha = (Get-FileHash -Algorithm SHA256 (Join-Path $app 'app\index.html')).Hash.ToLower()
    if ($ver.sha256 -ne $sha) { throw 'The downloaded page does not match its published checksum. Nothing was installed.' }

    # 3. Put it together
    Write-Host '3/4  Installing...'
    Stop-App
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    $ex = Join-Path $Tmp 'electron'
    Expand-Archive -Path (Join-Path $Tmp $zipName) -DestinationPath $ex -Force
    Move-Item $ex $Dest
    Rename-Item (Join-Path $Dest 'electron.exe') 'MBT Lab.exe'
    $res = Join-Path $Dest 'resources'
    New-Item -ItemType Directory -Path (Join-Path $res 'app') | Out-Null
    Copy-Item (Join-Path $app '*') (Join-Path $res 'app') -Recurse
    $loc = Join-Path $Dest 'locales'
    if (Test-Path $loc) { Get-ChildItem $loc -Filter *.pak | Where-Object { $_.Name -ne 'en-US.pak' } | Remove-Item -Force }

    # 4. Shortcuts
    Write-Host '4/4  Creating shortcuts...'
    $sh = New-Object -ComObject WScript.Shell
    foreach ($l in $Links) {
        $s = $sh.CreateShortcut($l); $s.TargetPath = $Exe; $s.WorkingDirectory = $Dest; $s.Description = 'MBT Lab'; $s.Save()
    }
    Write-Host ''
    Write-Host ("Installed build " + $ver.build + ". MBT Lab checks GitHub for newer versions every time it starts.")
    Write-Host 'Starting it now...'
    Start-Process $Exe
}
catch {
    Write-Host ''
    Write-Host ('Installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Check your internet connection and run the installer again.'
    exit 1
}
finally {
    if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
