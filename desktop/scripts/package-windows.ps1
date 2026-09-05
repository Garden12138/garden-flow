param(
    [ValidateSet('Unsigned', 'Signed')]
    [string]$Mode = 'Unsigned'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-PackageLog {
    param([string]$Message)
    Write-Host "[GardenFlow package] $Message"
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$CommandArguments
    )

    & $Command @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($CommandArguments -join ' ')"
    }
}

function Set-DefaultProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $CurrentValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($CurrentValue)) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        return $Value
    }

    return $CurrentValue
}

if ($env:OS -ne 'Windows_NT') {
    throw 'This script must be run on Windows.'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$DesktopDir = Split-Path -Parent $PSScriptRoot
$ToolsDir = Join-Path $DesktopDir '.packaging-tools'
$NodeVersion = if ($env:GARDENFLOW_NODE_VERSION) { $env:GARDENFLOW_NODE_VERSION } else { '22.23.2' }
$PnpmVersion = if ($env:GARDENFLOW_PNPM_VERSION) { $env:GARDENFLOW_PNPM_VERSION } else { '10.28.2' }
$NodeDistUrl = if ($env:GARDENFLOW_NODE_DIST_URL) {
    $env:GARDENFLOW_NODE_DIST_URL.TrimEnd('/')
} else {
    "https://nodejs.org/dist/v$NodeVersion"
}

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

$NodeArchive = "node-v$NodeVersion-win-x64.zip"
$NodeHome = Join-Path $ToolsDir "node-v$NodeVersion-win-x64"
$NodeArchivePath = Join-Path $ToolsDir $NodeArchive
$ShasumsPath = Join-Path $ToolsDir "SHASUMS256-v$NodeVersion.txt"
$NodeExe = Join-Path $NodeHome 'node.exe'

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
    Write-PackageLog "Preparing portable Node.js v$NodeVersion (x64)..."
    if (-not (Test-Path -LiteralPath $NodeArchivePath -PathType Leaf)) {
        Invoke-WebRequest -UseBasicParsing -Uri "$NodeDistUrl/$NodeArchive" -OutFile $NodeArchivePath
    }
    Invoke-WebRequest -UseBasicParsing -Uri "$NodeDistUrl/SHASUMS256.txt" -OutFile $ShasumsPath

    $ChecksumLine = Get-Content -LiteralPath $ShasumsPath | Where-Object {
        $_ -match "\s$([Regex]::Escape($NodeArchive))$"
    } | Select-Object -First 1
    if (-not $ChecksumLine) {
        throw "Checksum entry not found for $NodeArchive"
    }

    $ExpectedSha = ($ChecksumLine -split '\s+')[0].ToLowerInvariant()
    $ActualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeArchivePath).Hash.ToLowerInvariant()
    if ($ActualSha -ne $ExpectedSha) {
        Remove-Item -Force -LiteralPath $NodeArchivePath
        throw "Node.js checksum mismatch (expected $ExpectedSha, got $ActualSha)"
    }

    Expand-Archive -Force -LiteralPath $NodeArchivePath -DestinationPath $ToolsDir
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
        throw "Node.js extraction failed: $NodeExe was not created"
    }
}

$env:Path = "$NodeHome;$env:Path"

# Binary dependencies are hosted on GitHub by default, which is frequently
# unreachable on mainland China networks. Keep every value overridable so a
# company proxy or a private mirror can still be supplied by the caller.
$FfmpegBinariesUrl = Set-DefaultProcessEnvironment `
    -Name 'FFMPEG_BINARIES_URL' `
    -Value 'https://npmmirror.com/mirrors/ffmpeg-static'
$BetterSqliteBinaryHost = Set-DefaultProcessEnvironment `
    -Name 'npm_config_better_sqlite3_binary_host' `
    -Value 'https://registry.npmmirror.com/-/binary/better-sqlite3'
$ElectronMirror = Set-DefaultProcessEnvironment `
    -Name 'ELECTRON_MIRROR' `
    -Value 'https://npmmirror.com/mirrors/electron/'
$ElectronBuilderBinariesMirror = Set-DefaultProcessEnvironment `
    -Name 'ELECTRON_BUILDER_BINARIES_MIRROR' `
    -Value 'https://npmmirror.com/mirrors/electron-builder-binaries/'

$PnpmHome = Join-Path $ToolsDir "pnpm-$PnpmVersion"
$PnpmCli = Join-Path $PnpmHome 'node_modules\pnpm\bin\pnpm.cjs'
if (-not (Test-Path -LiteralPath $PnpmCli -PathType Leaf)) {
    Write-PackageLog "Installing local pnpm $PnpmVersion..."
    $NpmCommand = Join-Path $NodeHome 'npm.cmd'
    Invoke-CheckedCommand $NpmCommand install --prefix $PnpmHome --no-audit --no-fund "pnpm@$PnpmVersion"
}
$env:GARDENFLOW_PNPM_CLI = $PnpmCli

function Invoke-Pnpm {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$PnpmArguments
    )

    Invoke-CheckedCommand $NodeExe $PnpmCli @PnpmArguments
}

function Invoke-PnpmInstallWithRetry {
    param([int]$MaxAttempts = 3)

    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        try {
            Invoke-Pnpm install --frozen-lockfile
            return
        } catch {
            if ($Attempt -eq $MaxAttempts) {
                throw
            }

            $RetryDelaySeconds = 5 * $Attempt
            Write-PackageLog "Dependency installation failed (attempt $Attempt/$MaxAttempts). Retrying in $RetryDelaySeconds seconds..."
            Start-Sleep -Seconds $RetryDelaySeconds
        }
    }
}

Push-Location $DesktopDir
try {
    $ResolvedNodeVersion = (& $NodeExe --version).Trim()
    $ResolvedPnpmVersion = (& $NodeExe $PnpmCli --version).Trim()
    Write-PackageLog "Using Node.js $ResolvedNodeVersion, pnpm $ResolvedPnpmVersion"
    Write-PackageLog "FFmpeg mirror: $FfmpegBinariesUrl"
    Write-PackageLog "better-sqlite3 mirror: $BetterSqliteBinaryHost"
    Write-PackageLog "Electron mirror: $ElectronMirror"
    Write-PackageLog "Electron Builder mirror: $ElectronBuilderBinariesMirror"

    Write-PackageLog 'Installing project dependencies...'
    $PreviousCi = [Environment]::GetEnvironmentVariable('CI', 'Process')
    try {
        # Scope CI to dependency installation so pnpm can replace node_modules
        # without a TTY. It must not leak into electron-builder publish detection.
        $env:CI = 'true'
        Invoke-PnpmInstallWithRetry
    } finally {
        [Environment]::SetEnvironmentVariable('CI', $PreviousCi, 'Process')
    }

    Write-PackageLog 'Checking TypeScript...'
    Invoke-Pnpm run check:types

    if ($Mode -eq 'Signed') {
        if (-not $env:WIN_CSC_LINK -and -not $env:CSC_LINK) {
            throw 'Signed mode requires WIN_CSC_LINK or CSC_LINK to point to a Windows code-signing certificate.'
        }
        Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue
    } else {
        $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    }

    Write-PackageLog "Building Windows x64 package ($Mode)..."
    Invoke-Pnpm run prepare:plugin-runtime
    Invoke-Pnpm run prepare:windows-native-host
    Invoke-Pnpm run prepare:ffmpeg
    Invoke-Pnpm run clean
    Invoke-Pnpm exec tsc
    Invoke-Pnpm exec vite build
    Invoke-Pnpm run sync:prompt-library
    Invoke-Pnpm exec electron-builder --win --x64 --publish never

    Write-PackageLog 'Build completed. Artifacts:'
    Get-ChildItem -LiteralPath (Join-Path $DesktopDir 'release') -File |
        Where-Object { $_.Extension -in '.exe', '.blockmap', '.yml' } |
        Sort-Object Name |
        ForEach-Object { Write-Host $_.FullName }
} finally {
    Pop-Location
}
