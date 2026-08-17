!include nsDialogs.nsh
!include LogicLib.nsh
!include WinMessages.nsh

Var NRRuntimeCheckbox
Var NRRuntimeState
Var NRUserDataCheckbox
Var NRUserDataState
Var NRAllCheckbox
Var NRAllState
Var NRHome

LangString NRCleanupTitle 1036 "Désinstallation complète"
LangString NRCleanupTitle 1033 "Complete uninstall"
LangString NRCleanupSubtitle 1036 "Choisissez ce que NetsuBoard doit supprimer de ce PC."
LangString NRCleanupSubtitle 1033 "Choose what NetsuBoard should remove from this PC."
LangString NRAppLabel 1036 "Application NetsuBoard"
LangString NRAppLabel 1033 "NetsuBoard application"
LangString NRAppHint 1036 "Toujours supprimée"
LangString NRAppHint 1033 "Always removed"
LangString NRRuntimeLabel 1036 "Prérequis, réglages et caches"
LangString NRRuntimeLabel 1033 "Prerequisites, settings and caches"
LangString NRRuntimeHint 1036 "ffmpeg, yt-dlp, shaders GLSL, réglages machine et aperçus."
LangString NRRuntimeHint 1033 "ffmpeg, yt-dlp, GLSL shaders, machine settings and previews."
LangString NRUserDataLabel 1036 "Créations et données personnelles"
LangString NRUserDataLabel 1033 "Personal creations and data"
LangString NRUserDataHint 1036 "Fonds d'écran, préférences et historique récent. Vos fichiers .netsu ne sont jamais supprimés."
LangString NRUserDataHint 1033 "Wallpapers, preferences and recent history. Your .netsu files are never deleted."
LangString NRAllLabel 1036 "Tout supprimer"
LangString NRAllLabel 1033 "Remove everything"
LangString NRLockError 1036 "Un fichier de NetsuBoard est resté verrouillé par un autre programme et n'a pas pu être remplacé.$\n$\nFerme NetsuBoard (au besoin depuis le Gestionnaire des tâches), puis relance l'installation."
LangString NRLockError 1033 "A NetsuBoard file is still locked by another program and could not be replaced.$\n$\nClose NetsuBoard (from Task Manager if needed), then run the installer again."
LangString NRElevateAsk 1036 "NetsuBoard est installé dans :$\n$INSTDIR$\n$\nCe dossier demande des droits administrateur, que cette installation n'a pas. Continuer en tant qu'administrateur ?"
LangString NRElevateAsk 1033 "NetsuBoard is installed in:$\n$INSTDIR$\n$\nThat folder requires administrator rights, which this installer does not have. Continue as administrator?"
LangString NRWriteError 1036 "Impossible d'écrire dans :$\n$INSTDIR$\n$\nRéinstalle NetsuBoard dans un dossier qui t'appartient — le dossier proposé par défaut convient."
LangString NRWriteError 1033 "Cannot write to:$\n$INSTDIR$\n$\nReinstall NetsuBoard into a folder you own — the default location works."

UninstPage custom un.NetsuCleanupPage un.NetsuCleanupLeave

; Waits for a file to become writable, and stops the install with a readable message if it never
; does. Killing a process does not release its files synchronously: the image stays locked until the
; process object is destroyed, and an antivirus routinely holds a binary open while it scans it.
; Tauri's own CheckIfAppIsRunning sleeps a flat 500 ms and writes anyway, which is what surfaces as
; "error opening file for writing: $INSTDIR\app.exe" on a machine that took longer.
; `FileOpen a` opens for writing without truncating, which is exactly the access `File` needs next.
Function NetsuRequireWritable
  Exch $R0 ; file to wait for
  Push $R1 ; handle
  Push $R2 ; ticks, 250 ms each
  StrCpy $R2 0
  netsu_probe:
    IfFileExists "$R0" 0 netsu_probe_done
    ClearErrors
    FileOpen $R1 "$R0" a
    IfErrors 0 netsu_probe_close
    IntCmp $R2 60 netsu_probe_stuck 0 netsu_probe_stuck
    IntOp $R2 $R2 + 1
    Sleep 250
    Goto netsu_probe
  netsu_probe_close:
    FileClose $R1
    Goto netsu_probe_done
  netsu_probe_stuck:
    IfSilent +2
    MessageBox MB_ICONSTOP|MB_OK "$(NRLockError)"
    Abort
  netsu_probe_done:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Everything that would make the file section fail is settled here, BEFORE the first byte is
  ; written: a directory the user cannot write into, and files still held by the running app.

  ; 1. Write access. `installMode: currentUser` compiles to RequestExecutionLevel user, so an
  ; install someone pointed at Program Files — it only succeeded because they ran that first setup
  ; as administrator — can never be updated by the app itself: every File would be refused, one
  ; dialog at a time. Ask once and relaunch elevated on the same directory rather than fail.
  ; The probe is a real write: it also catches a folder locked by ransomware protection or an ACL.
  ClearErrors
  FileOpen $0 "$INSTDIR\netsuboard-write-probe.tmp" w
  ${If} ${Errors}
    ClearErrors
    ${GetOptions} $CMDLINE "/NRELEVATED" $1
    ${IfNot} ${Errors}
      ; Already came back from a UAC prompt and still cannot write: elevation is not the problem.
      IfSilent +2
      MessageBox MB_ICONSTOP|MB_OK "$(NRWriteError)"
      Abort
    ${EndIf}
    IfSilent netsu_elevate
    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "$(NRElevateAsk)" IDOK netsu_elevate
    Abort
    netsu_elevate:
    ; /D= must stay last and unquoted (NSIS reads the rest of the line as the directory), so the
    ; elevated run installs where this one was pointed instead of re-deriving it from a registry
    ; hive that may not be the same user's.
    ${GetParameters} $1
    ExecShell "runas" "$EXEPATH" "$1 /NRELEVATED /D=$INSTDIR"
    Quit
  ${Else}
    FileClose $0
    Delete "$INSTDIR\netsuboard-write-probe.tmp"
  ${EndIf}

  ; 2. A manual install can start while NetsuBoard is still open, and an in-app update always does.
  ; Ask its single window for a NORMAL close first: RunEvent::Exit then stops its node.exe core.
  ; No PowerShell, no process enumeration and no forced kill are involved.
  FindWindow $0 "" "NetsuBoard"
  StrCmp $0 0 netsu_window_gone
  SendMessage $0 ${WM_CLOSE} 0 0 /TIMEOUT=3000
  StrCpy $2 0
  netsu_wait_window:
    FindWindow $0 "" "NetsuBoard"
    StrCmp $0 0 netsu_window_gone
    IntCmp $2 16 netsu_window_gone 0 netsu_window_gone
    IntOp $2 $2 + 1
    Sleep 250
    Goto netsu_wait_window
  netsu_window_gone:

  ; 3. The window may never answer — a modal, a hung renderer, an in-app update that exits the
  ; process without running its shutdown, or an older version that left node.exe alive after a
  ; crash. The temporary copy of the app goes through Restart Manager, which closes ONLY the
  ; process whose image is the file passed. app.exe comes first so its own shutdown stops the core.
  ; `app.exe` is spelled out: it is Tauri's MAINBINARYNAME, which is the Cargo package name.
  ; InitPluginsDir is mandatory: until something initialises it, $PLUGINSDIR expands to nothing and
  ; the copy lands in $INSTDIR under a leading backslash, where the command below never finds it.
  InitPluginsDir
  File /oname=$PLUGINSDIR\netsuboard-release-lock.exe "..\..\app.exe"
  nsExec::ExecToLog '"$PLUGINSDIR\netsuboard-release-lock.exe" --release-lock "$INSTDIR\app.exe"'
  Pop $0
  nsExec::ExecToLog '"$PLUGINSDIR\netsuboard-release-lock.exe" --release-lock "$INSTDIR\resources\bin\node.exe"'
  Pop $0
  Delete "$PLUGINSDIR\netsuboard-release-lock.exe"

  ; 4. The exit code of the two calls above is deliberately ignored: Restart Manager can be
  ; unavailable, or refuse a process it cannot touch, on a machine where nothing holds the files at
  ; all. The only fact that decides is whether the files can be written now.
  Push "$INSTDIR\app.exe"
  Call NetsuRequireWritable
  Push "$INSTDIR\resources\bin\node.exe"
  Call NetsuRequireWritable
!macroend

Function un.NetsuCleanupPage
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(NRCleanupTitle)" "$(NRCleanupSubtitle)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 4u 100% 12u "$(NRAppLabel)"
  Pop $1
  CreateFont $2 "$(^Font)" "$(^FontSize)" "700"
  SendMessage $1 ${WM_SETFONT} $2 1
  ${NSD_CreateLabel} 18u 19u 90% 10u "$(NRAppHint)"
  Pop $1

  ${NSD_CreateCheckbox} 0 42u 100% 12u "$(NRRuntimeLabel)"
  Pop $NRRuntimeCheckbox
  ${NSD_CreateLabel} 18u 57u 90% 22u "$(NRRuntimeHint)"
  Pop $1

  ${NSD_CreateCheckbox} 0 88u 100% 12u "$(NRUserDataLabel)"
  Pop $NRUserDataCheckbox
  ${NSD_CreateLabel} 18u 103u 90% 28u "$(NRUserDataHint)"
  Pop $1

  ${NSD_CreateCheckbox} 0 142u 100% 12u "$(NRAllLabel)"
  Pop $NRAllCheckbox
  ${NSD_OnClick} $NRAllCheckbox un.NetsuAllChanged

  nsDialogs::Show
FunctionEnd

Function un.NetsuAllChanged
  ${NSD_GetState} $NRAllCheckbox $NRAllState
  ${NSD_SetState} $NRRuntimeCheckbox $NRAllState
  ${NSD_SetState} $NRUserDataCheckbox $NRAllState
FunctionEnd

Function un.NetsuCleanupLeave
  ${NSD_GetState} $NRRuntimeCheckbox $NRRuntimeState
  ${NSD_GetState} $NRUserDataCheckbox $NRUserDataState
  ${NSD_GetState} $NRAllCheckbox $NRAllState
  ${If} $NRAllState = ${BST_CHECKED}
    StrCpy $NRRuntimeState ${BST_CHECKED}
    StrCpy $NRUserDataState ${BST_CHECKED}
  ${EndIf}
FunctionEnd

; The cleanup runs as plain NSIS file operations, deliberately. Handing it to a PowerShell script
; copied into %TEMP% and launched with -ExecutionPolicy Bypass is the exact shape Defender's
; machine-learning classifiers score as a dropper, and that string sits in clear text inside the
; compiled installer, so it is scanned at INSTALL time even though the code only runs on uninstall.
;
; Only paths that unambiguously belong to NetsuBoard are removed: NR_HOME (%LOCALAPPDATA%\NetsuBoard)
; and the WebView2 profile keyed on the bundle identifier. NetsuRush's home, ~/.netsurush and the
; %TEMP%\netsurush-* caches are NEVER touched here, even though this application still writes into
; the last two (the name collisions listed in docs/invariants.md): the two products install side by
; side, and uninstalling one must not take the other's data with it.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Guard: with an empty %LOCALAPPDATA% every path below would resolve against the drive root.
    StrCpy $NRHome ""
    ${If} $LOCALAPPDATA != ""
      StrCpy $NRHome "$LOCALAPPDATA\NetsuBoard"
    ${EndIf}

    ${If} $NRHome != ""
    ${AndIf} $NRRuntimeState = ${BST_CHECKED}
      ; Runtime provisioned on first launch, machine-scoped settings and regenerable caches.
      RMDir /r "$NRHome\runtime"
      RMDir /r "$NRHome\bin"
      RMDir /r "$NRHome\models"
      RMDir /r "$NRHome\shaders"
      RMDir /r "$NRHome\adobe-snapshots"
      Delete "$NRHome\nr.config.json"
      Delete "$NRHome\export-caps.json"
      Delete "$NRHome\hardware.json"
      Delete "$NRHome\core-port.json"
      Delete "$NRHome\adobe-panel.json"
      Delete "$NRHome\discord-rpc.json"
      ; WebView2 profile: renderer local storage and session cookies.
      ${If} $LOCALAPPDATA != ""
        RMDir /r "$LOCALAPPDATA\com.netsuboard.app"
      ${EndIf}
      ${If} $APPDATA != ""
        RMDir /r "$APPDATA\com.netsuboard.app"
      ${EndIf}
    ${EndIf}

    ${If} $NRHome != ""
    ${AndIf} $NRUserDataState = ${BST_CHECKED}
      ; Boards live wherever the user saved their .netsu files and are never removed from here.
      RMDir /r "$NRHome\wallpapers"
      RMDir /r "$NRHome\snapshots"
      Delete "$NRHome\prefs.json"
      Delete "$NRHome\netsu-recents.json"
      Delete "$NRHome\upscale-ledger.json"
    ${EndIf}

    ; Not recursive: the home folder only goes away once nothing the user kept is left inside it.
    ${If} $NRHome != ""
      RMDir "$NRHome"
    ${EndIf}
  ${EndIf}
!macroend
