# Builds the ICAIRE Echo desktop app for Windows (64-bit Windows 10 and 11): dist\ICAIRE-Echo-<version>-windows-setup.exe.
# The app is a Tauri window (desktop\) with everything inside it: its own Node.js, the app's packages and the
# transcriber (whisper.cpp's official Windows build). It installs for the current user, without admin rights; your
# things live in %APPDATA%\ICAIRE Echo and stay when you uninstall.
#
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1     (needs Git, Node.js, Rust, and npm ci done)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Dist = Join-Path $Repo 'dist'
$Work = Join-Path $Dist 'work-win'
$Stage = Join-Path $Repo 'desktop\stage'
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '24.10.0' }
$RepoJs = $Repo -replace '\\', '/'
$Version = (node -p "require('$RepoJs/package.json').version").Trim()
Write-Host "== ICAIRE Echo $Version for Windows"

foreach ($d in $Work, $Stage) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory -Force -Path $Work, "$Stage\app\bin", $Dist | Out-Null

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

# 2. the app's own files (what git tracks, without tests, packaging, the desktop shell and notes)
$files = git -C $Repo ls-files | Where-Object { $_ -notmatch '^(test|packaging|desktop|docs|\.github)/' -and $_ -notmatch '^(TODO|PRODUCT|DESIGN)\.md$' }
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
if (Test-Path "$Stage\app\node_modules\.bin") { Remove-Item -Recurse -Force "$Stage\app\node_modules\.bin" }

# 4. the transcriber: whisper.cpp's official Windows build (the one lib/whisper.js names), checked
$wb = node -p "JSON.stringify(require('$RepoJs/lib/whisper.js').WINDOWS_BUILDS.cpu)" | ConvertFrom-Json
Get-Checked $wb.url "$Work\whisper.zip" $wb.sha256
Expand-Archive -Path "$Work\whisper.zip" -DestinationPath "$Stage\app\bin"
if (-not (Get-ChildItem "$Stage\app\bin" -Recurse -Filter 'whisper-cli.exe')) { throw 'whisper-cli.exe is not in the download' }

# 5. the desktop app around it (Tauri), with the version from package.json
Push-Location "$Repo\desktop"
& npx tauri build --bundles nsis --config "{\`"version\`":\`"$Version\`"}"
if ($LASTEXITCODE -ne 0) { throw 'the desktop app did not build' }
Pop-Location
$exe = Get-ChildItem "$Repo\desktop\target\release\bundle\nsis\*.exe" | Select-Object -First 1
Copy-Item $exe.FullName "$Dist\ICAIRE-Echo-$Version-windows-setup.exe"
Remove-Item -Recurse -Force $Work
Write-Host "== $Dist\ICAIRE-Echo-$Version-windows-setup.exe"
