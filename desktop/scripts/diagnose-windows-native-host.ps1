$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'This script must be run on Windows.'
}

function Write-DiagnosticSection {
    param([Parameter(Mandatory = $true)][string]$Title)
    Write-Output "`n=== $Title ==="
}

function Show-LogTail {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Path
    )
    Write-Output "$Label`: $Path"
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Output '  (not found)'
        return
    }
    Get-Content -LiteralPath $Path -Tail 100 | ForEach-Object { Write-Output "  $_" }
}

function Read-ExactBytes {
    param(
        [Parameter(Mandatory = $true)]$Stream,
        [Parameter(Mandatory = $true)][int]$Length,
        [int]$TimeoutMs = 5000
    )
    $Buffer = New-Object byte[] $Length
    $Offset = 0
    while ($Offset -lt $Length) {
        $ReadTask = $Stream.ReadAsync($Buffer, $Offset, $Length - $Offset)
        if (-not $ReadTask.Wait($TimeoutMs)) {
            throw "Timed out while reading $Length bytes from Native Host"
        }
        $ReadCount = $ReadTask.Result
        if ($ReadCount -le 0) {
            throw "Native Host closed stdout after $Offset of $Length bytes"
        }
        $Offset += $ReadCount
    }
    return ,$Buffer
}

function Test-NativeHostHandshake {
    param([Parameter(Mandatory = $true)][string]$ExecutablePath)

    $ExtensionOrigin = 'chrome-extension://dhfphfekcjahljnefpdjoidehnhhoeie/'
    $RequestJson = '{"jsonrpc":"2.0","id":"diagnostic","method":"ping","params":{}}'
    $RequestBytes = [Text.Encoding]::UTF8.GetBytes($RequestJson)
    $HeaderBytes = [BitConverter]::GetBytes([int]$RequestBytes.Length)
    $StartInfo = New-Object Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $ExecutablePath
    $StartInfo.Arguments = $ExtensionOrigin
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardInput = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $HostProcess = New-Object Diagnostics.Process
    $HostProcess.StartInfo = $StartInfo

    try {
        if (-not $HostProcess.Start()) {
            throw 'Windows did not start the Native Host process'
        }
        $HostProcess.StandardInput.BaseStream.Write($HeaderBytes, 0, $HeaderBytes.Length)
        $HostProcess.StandardInput.BaseStream.Write($RequestBytes, 0, $RequestBytes.Length)
        $HostProcess.StandardInput.BaseStream.Flush()

        $ResponseHeader = Read-ExactBytes -Stream $HostProcess.StandardOutput.BaseStream -Length 4
        $ResponseLength = [BitConverter]::ToInt32($ResponseHeader, 0)
        if ($ResponseLength -le 0 -or $ResponseLength -gt 1048576) {
            throw "Native Host returned invalid frame length: $ResponseLength"
        }
        $ResponseBytes = Read-ExactBytes -Stream $HostProcess.StandardOutput.BaseStream -Length $ResponseLength
        $ResponseJson = [Text.Encoding]::UTF8.GetString($ResponseBytes)
        $Response = $ResponseJson | ConvertFrom-Json
        if ($Response.id -ne 'diagnostic' -or $Response.result.ok -ne $true) {
            throw "Native Host returned an invalid handshake: $ResponseJson"
        }
        Write-Output "Handshake: OK ($ResponseLength response bytes)"
        Write-Output "Desktop Bridge: $($Response.result.desktopBridge.availability)"
    } catch {
        Write-Output "Handshake: FAILED - $($_.Exception.Message)"
    } finally {
        try { $HostProcess.StandardInput.Close() } catch {}
        if (-not $HostProcess.HasExited -and -not $HostProcess.WaitForExit(2000)) {
            try { $HostProcess.Kill() } catch {}
        }
        if ($HostProcess.HasExited) {
            Write-Output "Exit code: $($HostProcess.ExitCode)"
            $StandardError = $HostProcess.StandardError.ReadToEnd().Trim()
            if ($StandardError) {
                Write-Output "stderr: $StandardError"
            }
        }
        $HostProcess.Dispose()
    }
}

$StateRoot = Join-Path $env:APPDATA 'GardenFlow\native-host'
$ManifestPath = Join-Path $StateRoot 'manifests\chrome.com.gardenflow.browser_control.json'
$RegistryEntries = @(
    [PSCustomObject]@{ Browser = 'Chrome'; Path = 'Registry::HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.gardenflow.browser_control' },
    [PSCustomObject]@{ Browser = 'Edge'; Path = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.gardenflow.browser_control' },
    [PSCustomObject]@{ Browser = 'Brave'; Path = 'Registry::HKEY_CURRENT_USER\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.gardenflow.browser_control' }
)

Write-DiagnosticSection 'Environment'
Write-Output "State root: $StateRoot"
Write-Output "State root exists: $(Test-Path -LiteralPath $StateRoot -PathType Container)"

Write-DiagnosticSection 'Registry'
foreach ($Entry in $RegistryEntries) {
    if (-not (Test-Path -LiteralPath $Entry.Path)) {
        Write-Output "$($Entry.Browser): (not registered)"
        continue
    }
    $RegistryKey = Get-Item -LiteralPath $Entry.Path
    Write-Output "$($Entry.Browser): $($RegistryKey.GetValue(''))"
}

Write-DiagnosticSection 'Chrome Native Host manifest'
Write-Output "Manifest: $ManifestPath"
$HostExecutable = $null
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    Get-Content -LiteralPath $ManifestPath | ForEach-Object { Write-Output "  $_" }
    try {
        $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $HostExecutable = [string]$Manifest.path
    } catch {
        Write-Output "Manifest JSON error: $($_.Exception.Message)"
    }
} else {
    Write-Output '(not found)'
}

Write-DiagnosticSection 'Native Host executable'
if ([string]::IsNullOrWhiteSpace($HostExecutable)) {
    Write-Output 'Manifest does not provide an executable path.'
} else {
    Write-Output "Path: $HostExecutable"
    Write-Output "Exists: $(Test-Path -LiteralPath $HostExecutable -PathType Leaf)"
    if (Test-Path -LiteralPath $HostExecutable -PathType Leaf) {
        $HostFile = Get-Item -LiteralPath $HostExecutable
        Write-Output "Size: $($HostFile.Length) bytes"
        Write-Output "Modified: $($HostFile.LastWriteTime.ToString('o'))"
        Write-Output "SHA256: $((Get-FileHash -LiteralPath $HostExecutable -Algorithm SHA256).Hash)"
        Write-Output "Product: $($HostFile.VersionInfo.ProductName)"
        Write-Output "File version: $($HostFile.VersionInfo.FileVersion)"
        Test-NativeHostHandshake -ExecutablePath $HostExecutable
    }
}

Write-DiagnosticSection 'GardenFlow Native Host logs'
Show-LogTail -Label 'Structured log' -Path (Join-Path $StateRoot 'native-host.log')
Show-LogTail -Label 'Previous structured log' -Path (Join-Path $StateRoot 'native-host.previous.log')

Write-DiagnosticSection 'Browser logs'
$BrowserLogs = @(
    [PSCustomObject]@{ Browser = 'Chrome'; Path = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\chrome_debug.log') },
    [PSCustomObject]@{ Browser = 'Edge'; Path = (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\chrome_debug.log') },
    [PSCustomObject]@{ Browser = 'Brave'; Path = (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data\chrome_debug.log') }
)
foreach ($BrowserLog in $BrowserLogs) {
    Show-LogTail -Label $BrowserLog.Browser -Path $BrowserLog.Path
}
