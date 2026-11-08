$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $backendRoot '.tmp'
[System.IO.Directory]::CreateDirectory($privateDirectory) | Out-Null
$keyPath = Join-Path $privateDirectory 'gemini-api-key.txt'
if (Test-Path -LiteralPath $keyPath) {
    if ((Get-Item -LiteralPath $keyPath).Length -eq 0) { throw 'Existing key file is empty; configure it privately.' }
    $env:GEMINI_KEY_FILE = $keyPath
    Write-Output 'Using the existing private key file; its contents were not displayed.'
    return
}
$secureKey = Read-Host 'Gemini API key (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$stream = $null
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
    if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey -match '\s') { throw 'Invalid key format.' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($plainKey)
    $stream = [System.IO.File]::Open($keyPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $env:GEMINI_KEY_FILE = $keyPath
    Write-Output 'Private key saved under ignored backend/.tmp; no provider request was made.'
} finally {
    if ($stream) { $stream.Dispose() }
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $plainKey = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureKey.Dispose()
}
