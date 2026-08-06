; PixelOffice.iss — Inno Setup script for the offline GUI installer.
; Compiled via ISCC.exe by build-installer.mjs after stage-app.mjs and
; stage-runtime.mjs populate the "stage" directory referenced below.
;
; StageDir may be overridden on the ISCC command line to keep source paths
; under Windows MAX_PATH when the repo lives in a long worktree path:
;   ISCC.exe /DStageDir=C:\po-stage PixelOffice.iss
#define MyAppName "PixelOffice"
#define MyAppVersion "1.0.0"
#ifndef StageDir
  #define StageDir "stage"
#endif

[Setup]
AppId={{14563699-69D4-4F84-B774-9FF1CAC8F116}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\PixelOffice
DefaultGroupName=PixelOffice
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=PixelOffice-Setup
SetupIconFile=..\PixelOffice.ico
UninstallDisplayIcon={app}\PixelOffice.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\PixelOffice.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\stop.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\PixelOffice.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\PixelOffice"; Filename: "{app}\PixelOffice.exe"; IconFilename: "{app}\PixelOffice.ico"
Name: "{group}\PixelOffice Stop"; Filename: "{app}\PixelOffice.exe"; Parameters: "--stop"; IconFilename: "{app}\PixelOffice.ico"
Name: "{group}\Uninstall PixelOffice"; Filename: "{uninstallexe}"
Name: "{userdesktop}\PixelOffice"; Filename: "{app}\PixelOffice.exe"; IconFilename: "{app}\PixelOffice.ico"
Name: "{userdesktop}\PixelOffice Stop"; Filename: "{app}\PixelOffice.exe"; Parameters: "--stop"; IconFilename: "{app}\PixelOffice.ico"

[Run]
Filename: "{app}\PixelOffice.exe"; Description: "Launch PixelOffice"; Flags: postinstall nowait skipifsilent unchecked

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\node_modules"
Type: filesandordirs; Name: "{app}\runtime"

[Code]
var
  RemoveConfig: Boolean;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigJson, AppDir, AppDirEscaped: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    AppDirEscaped := AppDir;
    StringChange(AppDirEscaped, '\', '\\');
    ConfigJson :=
      '{' + #13#10 +
      '  "Runtime": "windows",' + #13#10 +
      '  "Url": "http://127.0.0.1:3484",' + #13#10 +
      '  "Browser": "auto",' + #13#10 +
      '  "WslDistro": "",' + #13#10 +
      '  "WslRepoPath": "",' + #13#10 +
      '  "WindowsRepoPath": "' + AppDirEscaped + '\\app"' + #13#10 +
      '}';
    SaveStringToFile(AppDir + '\config.json', ConfigJson, False);
  end;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{app}\PixelOffice.exe'), '--stop', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  RemoveConfig := (MsgBox('Also remove PixelOffice configuration (config.json)?',
    mbConfirmation, MB_YESNO) = IDYES);
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and RemoveConfig then
  begin
    DeleteFile(ExpandConstant('{app}\config.json'));
    RemoveDir(ExpandConstant('{app}'));
  end;
end;
