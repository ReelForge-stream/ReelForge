; Inno Setup script for ReelForge. Built by build.ps1, which stages everything in .\stage first.
; Compile manually with:  ISCC.exe /DAppVersion=0.1.0 /DJellyfinVersion=12.2 ReelForge.iss

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef JellyfinVersion
  #define JellyfinVersion "12.2"
#endif
#define ModuleDir "ReelForge_" + AppVersion + ".0"

[Setup]
AppId={{8A3B5C1E-0F6D-4E52-9B0A-6C2D7E4F1A93}
AppName=ReelForge
AppVersion={#AppVersion}
AppVerName=ReelForge {#AppVersion}
AppPublisher=ReelForge
AppPublisherURL=https://reelforge.stream
AppSupportURL=https://github.com/ReelForge-stream/ReelForge/issues
SetupIconFile=..\..\brand\reelforge.ico
UninstallDisplayIcon={app}\reelforge.ico
DefaultDirName={autopf}\ReelForge
DefaultGroupName=ReelForge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=ReelForge-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=ReelForge Media Server
CloseApplications=no

[Messages]
WelcomeLabel2=This installs ReelForge {#AppVersion}: your media server, with the Media Manager for duplicates and disk space.%n%nIt runs as a Windows service in the background and can run alongside Plex while you switch over. Built on the open-source Jellyfin {#JellyfinVersion} engine.

[Dirs]
Name: "{commonappdata}\ReelForge\data"
Name: "{commonappdata}\ReelForge\cache"
Name: "{commonappdata}\ReelForge\logs"

[Files]
; The engine (self-contained: includes .NET, the classic admin dashboard and NVENC-enabled ffmpeg)
Source: "stage\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
; Service wrapper
Source: "stage\ReelForgeService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "ReelForgeService.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\brand\reelforge.ico"; DestDir: "{app}"; Flags: ignoreversion
; ReelForge module (new UI + Media Manager). Older module versions are removed in [InstallDelete].
Source: "stage\module\ReelForge.dll"; DestDir: "{commonappdata}\ReelForge\data\plugins\{#ModuleDir}"; Flags: ignoreversion
Source: "stage\module\meta.json"; DestDir: "{commonappdata}\ReelForge\data\plugins\{#ModuleDir}"; Flags: ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{commonappdata}\ReelForge\data\plugins\ReelForge_*"
Type: filesandordirs; Name: "{app}\server"

[INI]
Filename: "{group}\ReelForge.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:8096/reelforge/"
Filename: "{group}\ReelForge.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\reelforge.ico"
Filename: "{group}\ReelForge.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"
Filename: "{group}\ReelForge server settings.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:8096/web/#/dashboard"
Filename: "{commondesktop}\ReelForge.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:8096/reelforge/"; Tasks: desktopicon
Filename: "{commondesktop}\ReelForge.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\reelforge.ico"; Tasks: desktopicon
Filename: "{commondesktop}\ReelForge.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Put a ReelForge shortcut on the desktop"
Name: "firewall"; Description: "Allow other devices on your network and VPN to connect (opens port 8096 to your local network only)"

[UninstallDelete]
Type: files; Name: "{group}\ReelForge.url"
Type: files; Name: "{group}\ReelForge server settings.url"
Type: files; Name: "{commondesktop}\ReelForge.url"

[Run]
Filename: "{app}\ReelForgeService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Registering the ReelForge service..."
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ReelForge Media Server"""; Flags: runhidden waituntilterminated; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""ReelForge Media Server"" dir=in action=allow protocol=TCP localport=8096 profile=any remoteip=localsubnet,100.64.0.0/10"; Flags: runhidden waituntilterminated; Tasks: firewall
Filename: "{app}\ReelForgeService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Starting ReelForge..."
Filename: "http://localhost:8096/"; Description: "Open ReelForge to finish setup"; Flags: postinstall shellexec nowait skipifsilent; Check: IsFirstInstall

[UninstallRun]
Filename: "{app}\ReelForgeService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\ReelForgeService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ReelForge Media Server"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"

[Code]
var
  FirstInstall: Boolean;

function IsFirstInstall: Boolean;
begin
  Result := FirstInstall;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  FirstInstall := not DirExists(ExpandConstant('{commonappdata}\ReelForge\data\data'));
  // Upgrading: stop and unregister the old service so files can be replaced.
  if FileExists(ExpandConstant('{app}\ReelForgeService.exe')) then
  begin
    Exec(ExpandConstant('{app}\ReelForgeService.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{app}\ReelForgeService.exe'), 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(1500);
  end;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('ReelForge was removed. Your libraries, users and watch history are still in C:\ProgramData\ReelForge — delete that folder if you don''t plan to reinstall.', mbInformation, MB_OK);
end;
