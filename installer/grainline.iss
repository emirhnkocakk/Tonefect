#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6B1F6D52-3C1E-4E56-9A0B-1A7E5C2D9F41}
AppName=Grainline
AppVersion={#AppVersion}
AppPublisher=emirhnkocakk
DefaultDirName={autopf}\Grainline
DefaultGroupName=Grainline
PrivilegesRequired=lowest
OutputDir=..\installer_out
OutputBaseFilename=Grainline-Setup
SetupIconFile=..\assets\logo.ico
UninstallDisplayIcon={app}\Grainline.exe
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
Source: "..\dist\Grainline\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Grainline"; Filename: "{app}\Grainline.exe"
Name: "{autodesktop}\Grainline"; Filename: "{app}\Grainline.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Grainline.exe"; Description: "{cm:LaunchProgram,Grainline}"; Flags: nowait postinstall

[InstallDelete]
Type: filesandordirs; Name: "{app}\.webprofile"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.webprofile"
Type: filesandordirs; Name: "{app}\uploads"
