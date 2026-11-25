; ICAIRE Echo installer (Inno Setup 6). Built by packaging\windows\build.ps1, which passes AppVersion, Stage and Dist.
; Installs for the current user without admin rights. Uninstalling removes the app, never your things in %APPDATA%\ICAIRE Echo.

[Setup]
AppId={{6E0B1C55-7C1E-4D2B-9F0A-1C2E3A4B5D6F}
AppName=ICAIRE Echo
AppVersion={#AppVersion}
AppVerName=ICAIRE Echo {#AppVersion}
AppPublisher=ICAIRE
AppPublisherURL=https://github.com/ICAIRE/icaire-echo
DefaultDirName={localappdata}\Programs\ICAIRE Echo
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir={#Dist}
OutputBaseFilename=ICAIRE-Echo-{#AppVersion}-windows-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\icon.ico
UninstallDisplayName=ICAIRE Echo
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Put ICAIRE Echo on the desktop"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\ICAIRE Echo"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\ICAIRE Echo.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\ICAIRE Echo"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\ICAIRE Echo.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\ICAIRE Echo.vbs"""; Description: "Open ICAIRE Echo"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; ask a running copy to quit first, so its files are not in use
Filename: "powershell.exe"; Parameters: "-NoProfile -Command ""try {{ Invoke-WebRequest -UseBasicParsing -Method Post -Headers @{{'x-mrb'='1'}} -Uri http://localhost:4777/api/quit -TimeoutSec 3 }} catch {{}}"""; Flags: runhidden; RunOnceId: "QuitEcho"

[Code]
// before an update: ask a running copy to quit, so its files can be replaced
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec('powershell.exe', '-NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Headers @{''x-mrb''=''1''} -Uri http://localhost:4777/api/quit -TimeoutSec 3 } catch {}"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(1500);
  Result := '';
end;
