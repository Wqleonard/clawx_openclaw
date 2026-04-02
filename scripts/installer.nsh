; StoryClaw Custom NSIS Installer/Uninstaller Script
;
; Low-risk version — removed behaviors that trigger AV heuristics:
;   REMOVED: nsProcess FindProcess/KillProcess
;   REMOVED: nsExec PowerShell execution
;   REMOVED: EnumRegKey all-user profile enumeration
;   REMOVED: WriteRegDWORD LongPathsEnabled (HKLM write, potential AV trigger)
;   KEPT: PATH update via native NSIS registry ops (no PowerShell/plugins)
;   KEPT: Session data cleanup on uninstall (current user only)

!macro customInstall
  ; Add resources\cli to current user PATH via registry (no PowerShell needed).
  ReadRegStr $0 HKCU "Environment" "PATH"
  StrCmp $0 "" _addPath
  StrCpy $1 "$0;$INSTDIR\resources\cli"
  Goto _writePath
  _addPath:
  StrCpy $1 "$INSTDIR\resources\cli"
  _writePath:
  WriteRegExpandStr HKCU "Environment" "PATH" "$1"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  ; Remove resources\cli from current user PATH via registry.
  ; Use StrCpy/StrLen to strip the entry without WordFunc.nsh dependency.
  ReadRegStr $0 HKCU "Environment" "PATH"
  StrLen $1 "$INSTDIR\resources\cli"

  ; Try removing ";$INSTDIR\resources\cli" (entry in middle or end)
  StrCpy $2 "$0" "" -$1
  StrCmp $2 "$INSTDIR\resources\cli" _stripEnd
  Goto _tryStart
  _stripEnd:
    StrLen $3 "$0"
    IntOp $3 $3 - $1
    IntOp $3 $3 - 1
    StrCpy $0 "$0" $3
    Goto _writePath

  _tryStart:
  ; Try removing "$INSTDIR\resources\cli;" (entry at start)
  StrCpy $2 "$0" $1
  StrCmp $2 "$INSTDIR\resources\cli" _stripStart
  Goto _writePath
  _stripStart:
    IntOp $3 $1 + 1
    StrCpy $0 "$0" "" $3

  _writePath:
  WriteRegExpandStr HKCU "Environment" "PATH" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Always clear auth/session cache so reinstall requires login again.
  DetailPrint "Clearing login session data..."
  RMDir /r "$APPDATA\storyclaw\Local Storage"
  RMDir /r "$APPDATA\storyclaw\Session Storage"
  RMDir /r "$APPDATA\storyclaw\IndexedDB"
  RMDir /r "$LOCALAPPDATA\storyclaw\Local Storage"
  RMDir /r "$LOCALAPPDATA\storyclaw\Session Storage"
  RMDir /r "$LOCALAPPDATA\storyclaw\IndexedDB"
  Delete "$APPDATA\storyclaw\Cookies"
  Delete "$APPDATA\storyclaw\Cookies-journal"
  Delete "$APPDATA\storyclaw\Network\Cookies"
  Delete "$APPDATA\storyclaw\Network\Cookies-journal"
  Delete "$LOCALAPPDATA\storyclaw\Cookies"
  Delete "$LOCALAPPDATA\storyclaw\Cookies-journal"
  Delete "$LOCALAPPDATA\storyclaw\Network\Cookies"
  Delete "$LOCALAPPDATA\storyclaw\Network\Cookies-journal"

  ; Ask whether to remove all remaining user data (current user only).
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all StoryClaw user data?$\r$\n$\r$\nLogin session data is always cleared.$\r$\n$\r$\nIf you choose YES, this will also delete:$\r$\n  - .openclaw folder$\r$\n  - AppData\Local\storyclaw$\r$\n  - AppData\Roaming\storyclaw" \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\storyclaw"
    RMDir /r "$APPDATA\storyclaw"

  _cu_skipRemove:
!macroend
