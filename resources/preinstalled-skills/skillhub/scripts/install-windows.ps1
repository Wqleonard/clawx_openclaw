Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$KitUrl = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"
)

function Resolve-PythonCmd {
  if (Get-Command py -ErrorAction SilentlyContinue) { return "py -3" }
  if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
  throw "Python not found. Please install Python 3 first."
}

$pythonCmd = Resolve-PythonCmd
$installBase = Join-Path $env:USERPROFILE ".skillhub"
$binDir = Join-Path $env:USERPROFILE "bin"

$tmpDir = Join-Path $env:TEMP ("skillhub-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {
  Write-Host "[1/5] Downloading kit..."
  $tgz = Join-Path $tmpDir "latest.tar.gz"
  Invoke-WebRequest -Uri $KitUrl -OutFile $tgz

  Write-Host "[2/5] Extracting..."
  tar -xzf $tgz -C $tmpDir

  $cliSrcDir = $null
  if (Test-Path (Join-Path $tmpDir "cli\skills_store_cli.py")) {
    $cliSrcDir = Join-Path $tmpDir "cli"
  } elseif (Test-Path (Join-Path $tmpDir "skills_store_cli.py")) {
    $cliSrcDir = $tmpDir
  } else {
    throw "skills_store_cli.py not found in package."
  }

  Write-Host "[3/5] Installing CLI files..."
  New-Item -ItemType Directory -Path $installBase -Force | Out-Null
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null

  Copy-Item (Join-Path $cliSrcDir "skills_store_cli.py") (Join-Path $installBase "skills_store_cli.py") -Force
  Copy-Item (Join-Path $cliSrcDir "skills_upgrade.py") (Join-Path $installBase "skills_upgrade.py") -Force
  Copy-Item (Join-Path $cliSrcDir "version.json") (Join-Path $installBase "version.json") -Force
  Copy-Item (Join-Path $cliSrcDir "metadata.json") (Join-Path $installBase "metadata.json") -Force

  $localIndex = Join-Path $cliSrcDir "skills_index.local.json"
  if (Test-Path $localIndex) {
    Copy-Item $localIndex (Join-Path $installBase "skills_index.local.json") -Force
  }

  $configPath = Join-Path $installBase "config.json"
  if (-not (Test-Path $configPath)) {
@"
{
  "self_update_url": "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json"
}
"@ | Set-Content -Path $configPath -Encoding UTF8
  }

  $cmdPath = Join-Path $binDir "skillhub.cmd"
@"
@echo off
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set SCRIPT=%USERPROFILE%\.skillhub\skills_store_cli.py
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%SCRIPT%" %*
  exit /b %errorlevel%
)
python "%SCRIPT%" %*
"@ | Set-Content -Path $cmdPath -Encoding ASCII

  $localCmdPath = Join-Path $binDir "skillhub-local.cmd"
@"
@echo off
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set SCRIPT=%USERPROFILE%\.skillhub\skills_store_cli.py
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%SCRIPT%" %*
  exit /b %errorlevel%
)
python "%SCRIPT%" %*
"@ | Set-Content -Path $localCmdPath -Encoding ASCII

  Write-Host "[4/5] Verifying..."
  & cmd /c "$pythonCmd `"$installBase\skills_store_cli.py`" --version"

  Write-Host "[5/5] Done."
  Write-Host ""
  Write-Host "Install complete."
  Write-Host "CLI script: $installBase\skills_store_cli.py"
  Write-Host "Wrapper:    $cmdPath"
  Write-Host "Wrapper:    $localCmdPath"
  Write-Host ""
  Write-Host "If 'skillhub' is not recognized, add this to User PATH manually:"
  Write-Host "  $binDir"
  Write-Host ""
  Write-Host "Quick test:"
  Write-Host "  skillhub-local search calendar"
}
finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
