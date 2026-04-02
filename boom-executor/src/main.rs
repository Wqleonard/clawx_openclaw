use clap::{ArgAction, Parser};
use std::iter;
use std::os::windows::ffi::OsStrExt;
use std::process::Command;
use std::{ffi::OsStr, mem::size_of};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE, HLOCAL, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Security::{
    CreateRestrictedToken, GetLengthSid, SetTokenInformation, PSID,
    TokenIntegrityLevel, DISABLE_MAX_PRIVILEGE, TOKEN_ACCESS_MASK, TOKEN_ADJUST_DEFAULT,
    TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, LUA_TOKEN,
};
use windows::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetCurrentProcessId, GetExitCodeProcess, OpenProcessToken,
    TerminateProcess, WaitForSingleObject, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
    CREATE_UNICODE_ENVIRONMENT, STARTF_USESTDHANDLES,
};

#[derive(Parser, Debug)]
#[command(name = "boom-executor")]
#[command(about = "Boom low-privilege executor launcher")]
struct Cli {
    #[arg(long = "integrity-floor", action = ArgAction::SetTrue)]
    low_il: bool,
    #[arg(long = "cap-drop-token", action = ArgAction::SetTrue)]
    restricted_token: bool,
    #[arg(long = "process-cage", action = ArgAction::SetTrue)]
    job_object: bool,
    #[arg(long)]
    max_processes: Option<u32>,
    #[arg(long)]
    timeout: Option<u64>,
    #[arg(long = "writable-dir")]
    writable_dirs: Vec<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    verbose: bool,
    #[arg(last = true, required = true)]
    cmd: Vec<String>,
}

fn main() {
    let cli = Cli::parse();
    if cli.verbose {
        let pid = unsafe { GetCurrentProcessId() };
        eprintln!("[boom-executor] pid={}", pid);
        eprintln!(
            "[boom-executor] flags lowIL={} restrictedToken={} jobObject={} maxProc={:?} timeout={:?} writableDirs={}",
            cli.low_il,
            cli.restricted_token,
            cli.job_object,
            cli.max_processes,
            cli.timeout,
            cli.writable_dirs.len()
        );
    }

    if cli.cmd.is_empty() {
        eprintln!("[boom-executor] missing command after --");
        std::process::exit(2);
    }

    let timeout_ms = cli.timeout.map(|s| s.saturating_mul(1000));

    for dir in &cli.writable_dirs {
        if let Err(err) = grant_low_integrity_write(dir) {
            eprintln!("[boom-executor] {}", err);
        }
    }

    let result = unsafe { launch_with_policy(&cli, timeout_ms) };
    match result {
        Ok(code) => std::process::exit(code as i32),
        Err(err) => {
            eprintln!("[boom-executor] {}", err);
            std::process::exit(1);
        }
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(iter::once(0)).collect()
}

fn quote_if_needed(v: &str) -> String {
    if v.contains(' ') || v.contains('\t') || v.contains('"') {
        format!("\"{}\"", v.replace('"', "\\\""))
    } else {
        v.to_string()
    }
}

fn build_command_line(cmd: &[String]) -> String {
    cmd.iter().map(|s| quote_if_needed(s)).collect::<Vec<_>>().join(" ")
}

fn grant_low_integrity_write(dir: &str) -> Result<(), String> {
    let path = std::path::Path::new(dir);
    if !path.exists() {
        return Err(format!("GrantLowIntegrityWrite: directory does not exist: {}", dir));
    }
    let output = Command::new("icacls")
        .arg(dir)
        .arg("/setintegritylevel")
        .arg("(OI)(CI)L")
        .output()
        .map_err(|e| format!("GrantLowIntegrityWrite: icacls spawn failed for '{}': {}", dir, e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "SetNamedSecurityInfo failed for '{}': {}",
            dir,
            output.status.code().unwrap_or(-1)
        ))
    }
}

unsafe fn create_policy_token(restricted: bool, low_il: bool, verbose: bool) -> Result<HANDLE, String> {
    let mut current_token: HANDLE = HANDLE::default();
    let desired_access: TOKEN_ACCESS_MASK =
        TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT;
    OpenProcessToken(GetCurrentProcess(), desired_access, &mut current_token)
        .map_err(|e| format!("OpenProcessToken failed: {}", e))?;

    let mut token = current_token;
    if restricted {
        let mut restricted_token: HANDLE = HANDLE::default();
        let restricted_flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN;
        CreateRestrictedToken(
            token,
            restricted_flags,
            None,
            None,
            None,
            &mut restricted_token,
        )
        .map_err(|e| format!("CreateRestrictedToken failed: {}", e))?;
        let _ = CloseHandle(token);
        token = restricted_token;
        if verbose {
            eprintln!(
                "[boom-executor] Created restricted token (admin SIDs deny-only, privileges stripped)"
            );
        }
    }

    if low_il {
        let sid_wide = to_wide("S-1-16-4096");
        let mut low_sid = PSID::default();
        ConvertStringSidToSidW(PCWSTR(sid_wide.as_ptr()), &mut low_sid)
            .map_err(|e| format!("ConvertStringSidToSidW failed: {}", e))?;

        let mut label = TOKEN_MANDATORY_LABEL::default();
        label.Label.Sid = low_sid;
        label.Label.Attributes = 0x20;
        let tm_size = (size_of::<TOKEN_MANDATORY_LABEL>() + GetLengthSid(low_sid) as usize) as u32;

        SetTokenInformation(
            token,
            TokenIntegrityLevel,
            &label as *const _ as *const _,
            tm_size,
        )
        .map_err(|e| format!("SetTokenInformation(TokenIntegrityLevel) failed: {}", e))?;
        let _ = LocalFree(HLOCAL(low_sid.0));
        if verbose {
            eprintln!("[boom-executor] Set token to Low Integrity Level");
        }
    }

    Ok(token)
}

unsafe fn launch_with_policy(cli: &Cli, timeout_ms: Option<u64>) -> Result<u32, String> {
    let token = create_policy_token(cli.restricted_token, cli.low_il, cli.verbose)?;
    let mut cmdline_w = to_wide(&build_command_line(&cli.cmd));
    let app_w = to_wide(&cli.cmd[0]);

    let mut si = STARTUPINFOW::default();
    si.cb = size_of::<STARTUPINFOW>() as u32;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE)
        .map_err(|e| format!("GetStdHandle(STD_INPUT_HANDLE) failed: {}", e))?;
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE)
        .map_err(|e| format!("GetStdHandle(STD_OUTPUT_HANDLE) failed: {}", e))?;
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE)
        .map_err(|e| format!("GetStdHandle(STD_ERROR_HANDLE) failed: {}", e))?;
    let mut pi = PROCESS_INFORMATION::default();
    let creation_flags: PROCESS_CREATION_FLAGS = CREATE_UNICODE_ENVIRONMENT;

    CreateProcessAsUserW(
        token,
        PCWSTR(app_w.as_ptr()),
        PWSTR(cmdline_w.as_mut_ptr()),
        None,
        None,
        true,
        creation_flags,
        None,
        PCWSTR::null(),
        &si,
        &mut pi,
    )
    .map_err(|e| {
        format!("CreateProcessAsUserW failed: {}", e)
    })?;

    let mut job: HANDLE = HANDLE::default();
    if cli.job_object {
        job = CreateJobObjectW(None, PCWSTR::null()).map_err(|e| format!("CreateJobObjectW failed: {}", e))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Some(max_proc) = cli.max_processes {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            info.BasicLimitInformation.ActiveProcessLimit = max_proc;
        }
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| format!("SetInformationJobObject failed: {}", e))?;
        AssignProcessToJobObject(job, pi.hProcess)
            .map_err(|e| format!("AssignProcessToJobObject failed: {}", e))?;
        if cli.verbose {
            eprintln!(
                "[boom-executor] Assigned process to Job Object (maxProc={})",
                cli.max_processes.unwrap_or(0)
            );
        }
    }

    let wait_ms = timeout_ms
        .map(|v| v.min(u32::MAX as u64) as u32)
        .unwrap_or(u32::MAX);
    let wait_res = WaitForSingleObject(pi.hProcess, wait_ms);
    if wait_res == WAIT_TIMEOUT {
        if cli.verbose {
            eprintln!(
                "[boom-executor] Child process timed out after {} seconds, terminating",
                cli.timeout.unwrap_or(0)
            );
        }
        if cli.job_object && !job.is_invalid() {
            let _ = TerminateJobObject(job, 1);
        } else {
            let _ = TerminateProcess(pi.hProcess, 1);
        }
        let _ = CloseHandle(pi.hThread);
        let _ = CloseHandle(pi.hProcess);
        if !job.is_invalid() {
            let _ = CloseHandle(job);
        }
        let _ = CloseHandle(token);
        return Ok(124);
    }

    if wait_res != WAIT_OBJECT_0 {
        let err = GetLastError().0;
        let _ = CloseHandle(pi.hThread);
        let _ = CloseHandle(pi.hProcess);
        if !job.is_invalid() {
            let _ = CloseHandle(job);
        }
        let _ = CloseHandle(token);
        return Err(format!("WaitForSingleObject failed: {}", err));
    }

    let mut exit_code = 1u32;
    GetExitCodeProcess(pi.hProcess, &mut exit_code).map_err(|e| format!("GetExitCodeProcess failed: {}", e))?;
    let _ = CloseHandle(pi.hThread);
    let _ = CloseHandle(pi.hProcess);
    if !job.is_invalid() {
        let _ = CloseHandle(job);
    }
    let _ = CloseHandle(token);
    Ok(exit_code)
}
