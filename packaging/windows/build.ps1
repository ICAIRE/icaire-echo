# Builds "ICAIRE-Echo-<version>-windows-setup.exe" in dist\ (64-bit Windows 10 and 11).
# Everything the app needs is inside it: its own Node.js, the app's packages, and the transcriber (whisper.cpp's
# official Windows build). It installs for the current user, without admin rights, into
# %LOCALAPPDATA%\Programs\ICAIRE Echo; your things live in %APPDATA%\ICAIRE Echo and stay when you uninstall.
#
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1     (needs Git, Node.js and Inno Setup 6)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Dist = Join-Path $Repo 'dist'
$Work = Join-Path $Dist 'work-win'
$Stage = Join-Path $Dist 'win'
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '24.10.0' }
$Version = (node -p "require('$($Repo -replace '\\','/')/package.json').version").Trim()
Write-Host "== ICAIRE Echo $Version for Windows"

foreach ($d in $Work, $Stage) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory -Force -Path $Work, "$Stage\app\bin" | Out-Null

function Get-Checked($Url, $File, $Sha256) {
  Invoke-WebRequest -Uri $Url -OutFile $File -UseBasicParsing
  $got = (Get-FileHash -Algorithm SHA256 $File).Hash.ToLower()
  if ($got -ne $Sha256.ToLower()) { throw "$File does not match its checksum ($got)" }
}

# 1. Node.js: the official build, checked against nodejs.org's checksums
$NodePkg = "node-v$NodeVersion-win-x64"
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile "$Work\SHASUMS256.txt" -UseBasicParsing
$NodeSha = ((Get-Content "$Work\SHASUMS256.txt") | Where-Object { $_ -match " $NodePkg\.zip$" }).Split(' ')[0]
Get-Checked "https://nodejs.org/dist/v$NodeVersion/$NodePkg.zip" "$Work\node.zip" $NodeSha
Expand-Archive -Path "$Work\node.zip" -DestinationPath $Work
Copy-Item "$Work\$NodePkg\node.exe" "$Stage\node.exe"

# 2. the app's own files (what git tracks, without tests, packaging and the old installers)
$files = git -C $Repo ls-files | Where-Object { $_ -notmatch '^(test|packaging|installer|docs|\.github)/' -and $_ -notmatch '^Start ' -and $_ -notmatch '^(TODO|PRODUCT|DESIGN)\.md$' }
foreach ($f in $files) {
  $dst = Join-Path "$Stage\app" $f
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item (Join-Path $Repo $f) $dst
}

# 3. the packages, installed with the bundled Node; other platforms' engines removed
Push-Location "$Stage\app"
$env:PATH = "$Work\$NodePkg;$env:PATH"
& "$Work\$NodePkg\npm.cmd" ci --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
Pop-Location
Get-ChildItem "$Stage\app\node_modules\onnxruntime-node\bin\*\*" -Directory | Where-Object { $_.Name -ne 'win32' } | Remove-Item -Recurse -Force
Get-ChildItem "$Stage\app\node_modules\onnxruntime-node\bin\*\win32\*" -Directory | Where-Object { $_.Name -ne 'x64' } | Remove-Item -Recurse -Force
Get-ChildItem "$Stage\app\node_modules" -Directory -Filter 'sherpa-onnx-*' | Where-Object { $_.Name -notin 'sherpa-onnx-node', 'sherpa-onnx-win-x64' } | Remove-Item -Recurse -Force

# 4. the transcriber: whisper.cpp's official Windows build (the one lib/whisper.js names), checked
$wb = node -p "JSON.stringify(require('$($Repo -replace '\\','/')/lib/whisper.js').WINDOWS_BUILDS.cpu)" | ConvertFrom-Json
Get-Checked $wb.url "$Work\whisper.zip" $wb.sha256
Expand-Archive -Path "$Work\whisper.zip" -DestinationPath "$Stage\app\bin"
if (-not (Get-ChildItem "$Stage\app\bin" -Recurse -Filter 'whisper-cli.exe')) { throw 'whisper-cli.exe is not in the download' }

# 5. the launcher and icon
Copy-Item "$PSScriptRoot\ICAIRE Echo.vbs" "$Stage\ICAIRE Echo.vbs"
Copy-Item "$PSScriptRoot\icon.ico" "$Stage\icon.ico"

# 6. the installer
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 is not installed (choco install innosetup)' }
& $iscc "/DAppVersion=$Version" "/DStage=$Stage" "/DDist=$Dist" "$PSScriptRoot\echo.iss" | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'the installer did not build' }
Remove-Item -Recurse -Force $Work
Write-Host "== $Dist\ICAIRE-Echo-$Version-windows-setup.exe"
