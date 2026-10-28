#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
; AppId must stay the Grainline one: old installs upgrade in place to Tonefect instead of side by side.
AppId={{6B1F6D52-3C1E-4E56-9A0B-1A7E5C2D9F41}
AppName=Tonefect
AppVersion={#AppVersion}
AppPublisher=emirhnkocakk
DefaultDirName={autopf}\Tonefect
DefaultGroupName=Tonefect
PrivilegesRequired=lowest
OutputDir=..\installer_out
OutputBaseFilename=Tonefect-Setup
SetupIconFile=..\assets\logo.ico
UninstallDisplayIcon={app}\Tonefect.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\Tonefect\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Tonefect"; Filename: "{app}\Tonefect.exe"
Name: "{autodesktop}\Tonefect"; Filename: "{app}\Tonefect.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Tonefect.exe"; Description: "{cm:LaunchProgram,Tonefect}"; Flags: nowait postinstall

[InstallDelete]
Type: filesandordirs; Name: "{app}\.webprofile"
; leftovers from versions installed under the Grainline name
Type: files; Name: "{app}\Grainline.exe"
Type: files; Name: "{autoprograms}\Grainline.lnk"
Type: files; Name: "{autodesktop}\Grainline.lnk"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.webprofile"
Type: filesandordirs; Name: "{app}\uploads"
