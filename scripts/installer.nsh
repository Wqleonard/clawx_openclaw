; StoryClaw Custom NSIS Installer/Uninstaller Script
;
; Low-risk version — removed behaviors that trigger AV heuristics:
;   REMOVED: nsProcess FindProcess/KillProcess
;   ADJUSTED: install reporters use best-effort nsExec (hidden console)
;   REMOVED: EnumRegKey all-user profile enumeration
;   REMOVED: WriteRegDWORD LongPathsEnabled (HKLM write, potential AV trigger)
;   KEPT: PATH update via native NSIS registry ops (no PowerShell/plugins)
;   KEPT: Session data cleanup on uninstall (current user only)

Var InstallStartTick
Var InstallReportExitCode
Var InstallDebugDir
Var InstallDebugLogPath
Var InstallOpenReportResult
Var InstallOpenReportOutput
Var InstallFinishTick
Var InstallReportOutput

!define INSTALL_OPEN_BASE_URL "https://sd6sccbpgrokt7kpdca6g.apigateway-cn-beijing.volceapi.com"
!define INSTALL_OPEN_PATH "/data-analysis-records"
!define INSTALL_DEBUG_LOG_ENABLED "1"

Function DebugLog
  Exch $0
  StrCmp "${INSTALL_DEBUG_LOG_ENABLED}" "1" 0 _debug_log_done
  CreateDirectory "$InstallDebugDir"
  FileOpen $1 "$InstallDebugLogPath" a
  FileWrite $1 "$0$\r$\n"
  FileClose $1
  _debug_log_done:
  Pop $0
FunctionEnd

!macro customInit
  StrCpy $InstallDebugDir "$TEMP\storyclaw-install-telemetry"
  StrCpy $InstallDebugLogPath "$InstallDebugDir\nsis-installer-debug.log"
  System::Call 'kernel32::GetTickCount() i .r0'
  StrCpy $InstallStartTick $0
  Push "=== customInit begin ==="
  Call DebugLog
  Push "app_id=${APP_ID}; product=${PRODUCT_NAME}; version=${VERSION}"
  Call DebugLog
  Push "start_tick=$InstallStartTick"
  Call DebugLog
  Push "open_base_url=${INSTALL_OPEN_BASE_URL}; open_path=${INSTALL_OPEN_PATH}"
  Call DebugLog
  Call ReportInstallerOpen
!macroend

Function ReportInstallerOpen
  StrCpy $6 "${INSTALL_OPEN_BASE_URL}"
  StrCmp $6 "" _install_open_skip_empty
  StrCmp $6 "__INSTALL_REPORT_BASE_URL__" _install_open_skip_empty

  StrCpy $7 "${INSTALL_OPEN_PATH}"
  StrCmp $7 "" 0 +2
  StrCpy $7 "/data-analysis-records"

  StrCpy $8 "$6$7"
  Push "[install_open] endpoint=$8"
  Call DebugLog

  ; Best-effort only. Do not block installer startup.
  ; Node is bundled via extraResources (to: resources/), so runtime path is
  ; usually "$INSTDIR\resources\resources\bin\node.exe". Keep legacy fallback.
  StrCpy $2 "$INSTDIR\resources\resources\bin\node.exe"
  IfFileExists "$2" +2 0
  StrCpy $2 "$INSTDIR\resources\bin\node.exe"
  IfFileExists "$2" 0 _install_open_node_missing

  ; Reporter is bundled via extraResources (to: resources/), so the runtime
  ; path is usually "$INSTDIR\resources\resources\installer\...".
  ; Keep a fallback to the legacy "$INSTDIR\resources\installer\..." path.
  StrCpy $3 "$INSTDIR\resources\resources\installer\install-open-reporter.cjs"
  IfFileExists "$3" +3 0
  StrCpy $3 "$INSTDIR\resources\installer\install-open-reporter.cjs"
  IfFileExists "$3" 0 _install_open_script_missing
  Push "[install_open] node_path=$2"
  Call DebugLog
  Push "[install_open] reporter_path=$3"
  Call DebugLog

  StrCpy $4 ""
  StrCmp "${INSTALL_DEBUG_LOG_ENABLED}" "1" 0 +2
  StrCpy $4 ' --debug-log-dir "$TEMP\storyclaw-install-telemetry"'
  nsExec::ExecToStack '"$2" "$3" --app-id "${APP_ID}" --product-name "${PRODUCT_NAME}" --version "${VERSION}" --app-slug "storyclaw" --source "nsis_init" --telemetry-dir "$LOCALAPPDATA\storyclaw\telemetry"$4'
  Pop $InstallOpenReportResult
  Pop $InstallOpenReportOutput
  Push "[install_open] reporter_exit_code=$InstallOpenReportResult"
  Call DebugLog
  Push "[install_open] reporter_output=$InstallOpenReportOutput"
  Call DebugLog
  Goto _install_open_done

  _install_open_node_missing:
  Push "[install_open] skipped: node not found at $2"
  Call DebugLog
  Goto _install_open_done

  _install_open_script_missing:
  Push "[install_open] skipped: reporter script not found at $3"
  Call DebugLog
  Goto _install_open_done

  _install_open_skip_empty:
  Push "[install_open] skipped: INSTALL_OPEN_BASE_URL is empty or placeholder."
  Call DebugLog

  _install_open_done:
  Push "[install_open] done."
  Call DebugLog
FunctionEnd

Function RunInstallSuccessReport
  System::Call 'kernel32::GetTickCount() i .r0'
  StrCpy $InstallFinishTick $0
  IntOp $1 $0 - $InstallStartTick
  Push "=== customInstall telemetry begin ==="
  Call DebugLog
  Push "[install_complete] finish_tick=$InstallFinishTick; duration_ms=$1"
  Call DebugLog

  ; Debug-only tracing (disabled):
  ; CreateDirectory "$TEMP\storyclaw-install-telemetry"
  ; FileOpen $4 "$TEMP\storyclaw-install-telemetry\nsis-install-report.log" a
  ; FileWrite $4 "start install telemetry$\r$\n"
  ; FileClose $4

  ; Node is bundled via extraResources (to: resources/), so runtime path is
  ; usually "$INSTDIR\resources\resources\bin\node.exe". Keep legacy fallback.
  StrCpy $2 "$INSTDIR\resources\resources\bin\node.exe"
  IfFileExists "$2" +2 0
  StrCpy $2 "$INSTDIR\resources\bin\node.exe"
  IfFileExists "$2" 0 _install_report_node_missing

  ; Reporter is bundled via extraResources (to: resources/), so the runtime
  ; path is usually "$INSTDIR\resources\resources\installer\...".
  ; Keep a fallback to the legacy "$INSTDIR\resources\installer\..." path.
  StrCpy $3 "$INSTDIR\resources\resources\installer\install-success-reporter.cjs"
  IfFileExists "$3" +3 0
  StrCpy $3 "$INSTDIR\resources\installer\install-success-reporter.cjs"
  IfFileExists "$3" 0 _install_report_script_missing
  Push "[install_complete] node_path=$2"
  Call DebugLog
  Push "[install_complete] reporter_path=$3"
  Call DebugLog

  ; Debug-only tracing (disabled):
  ; DetailPrint "Install telemetry target: $LOCALAPPDATA\storyclaw\telemetry"
  ; DetailPrint "Install telemetry debug: $TEMP\storyclaw-install-telemetry"
  StrCpy $4 ""
  StrCmp "${INSTALL_DEBUG_LOG_ENABLED}" "1" 0 +2
  StrCpy $4 ' --debug-log-dir "$TEMP\storyclaw-install-telemetry"'
  nsExec::ExecToStack '"$2" "$3" --app-id "${APP_ID}" --product-name "${PRODUCT_NAME}" --version "${VERSION}" --channel "stable" --source "nsis" --install-duration-ms "$1" --app-slug "storyclaw" --telemetry-dir "$LOCALAPPDATA\storyclaw\telemetry"$4'
  Pop $InstallReportExitCode
  Pop $InstallReportOutput
  Push "[install_complete] reporter_exit_code=$InstallReportExitCode"
  Call DebugLog
  Push "[install_complete] reporter_output=$InstallReportOutput"
  Call DebugLog
  ; Debug-only tracing (disabled):
  ; DetailPrint "Install telemetry reporter exit code: $InstallReportExitCode"
  ; FileOpen $4 "$TEMP\storyclaw-install-telemetry\nsis-install-report.log" a
  ; FileWrite $4 "reporter exit code: $InstallReportExitCode$\r$\n"
  ; FileClose $4
  Goto _install_report_done

  _install_report_node_missing:
  Push "[install_complete] skipped: node not found at $2"
  Call DebugLog
  ; Debug-only tracing (disabled):
  ; DetailPrint "Install telemetry skipped: node not found at $2"
  ; FileOpen $4 "$TEMP\storyclaw-install-telemetry\nsis-install-report.log" a
  ; FileWrite $4 "node missing: $2$\r$\n"
  ; FileClose $4
  Goto _install_report_done

  _install_report_script_missing:
  Push "[install_complete] skipped: reporter script not found at $3"
  Call DebugLog
  ; Debug-only tracing (disabled):
  ; DetailPrint "Install telemetry skipped: reporter not found at $3"
  ; FileOpen $4 "$TEMP\storyclaw-install-telemetry\nsis-install-report.log" a
  ; FileWrite $4 "reporter missing: $3$\r$\n"
  ; FileClose $4

  _install_report_done:
  Push "=== customInstall telemetry done ==="
  Call DebugLog
FunctionEnd

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

  ; Best-effort installer telemetry. Failures are handled by the reporter script
  ; and never block a successful installation.
  Call RunInstallSuccessReport
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
