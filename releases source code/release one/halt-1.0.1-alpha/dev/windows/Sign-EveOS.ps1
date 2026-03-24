# HALT Code Signing Script
# Signs PowerShell scripts, batch files, and executables for Windows Smart App Control trust

param(
    [ValidateSet("sign", "create-cert", "verify", "help")]
    [string]$Action = "sign",
    
    [string]$CertificatePath = "",
    [string]$CertificateThumbprint = "",
    [SecureString]$CertificatePassword,
    
    [string]$TimestampServer = "http://timestamp.digicert.com",
    
    [string[]]$FilesToSign = @(),
    [switch]$SignAll,
    
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CertName = "HALT Code Signing Certificate"
$CertStorePath = "Cert:\CurrentUser\My"

# Helper functions
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Show-SigningHelp {
    Write-Host ""
    Write-Host "HALT Code Signing Script" -ForegroundColor Green
    Write-Host "==========================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Actions:" -ForegroundColor Cyan
    Write-Host "  create-cert  Create a self-signed code signing certificate"
    Write-Host "  sign         Sign files with the certificate"
    Write-Host "  verify       Verify signatures on files"
    Write-Host "  help         Show this help message"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # Step 1: Create a self-signed certificate (run once)" -ForegroundColor Yellow
    Write-Host "  .\Sign-Halt.ps1 -Action create-cert"
    Write-Host ""
    Write-Host "  # Step 2: Sign all installer files" -ForegroundColor Yellow
    Write-Host "  .\Sign-Halt.ps1 -Action sign -SignAll"
    Write-Host ""
    Write-Host "  # Sign specific files" -ForegroundColor Yellow
    Write-Host '  .\Sign-Halt.ps1 -Action sign -FilesToSign @("install-halt.bat", "Build-Halt.exe.ps1")'
    Write-Host ""
    Write-Host "  # Verify signatures" -ForegroundColor Yellow
    Write-Host "  .\Sign-Halt.ps1 -Action verify -SignAll"
    Write-Host ""
    Write-Host "For Commercial Certificates:" -ForegroundColor Cyan
    Write-Host "  .\Sign-Halt.ps1 -Action sign -SignAll -CertificatePath 'path\to\cert.pfx'"
    Write-Host ""
}

function Get-SigningCertificate {
    param(
        [string]$Path,
        [string]$Thumbprint,
        [SecureString]$Password
    )
    
    # Priority 1: Use provided PFX file (commercial certificate)
    if ($Path -and (Test-Path $Path)) {
        Write-Info "Loading certificate from file: $Path"
        if ($Password) {
            $cert = Get-PfxCertificate -FilePath $Path -Password $Password
        }
        else {
            $cert = Get-PfxCertificate -FilePath $Path
        }
        return $cert
    }
    
    # Priority 2: Use thumbprint to find certificate
    if ($Thumbprint) {
        Write-Info "Looking for certificate by thumbprint: $Thumbprint"
        $cert = Get-ChildItem $CertStorePath | Where-Object { $_.Thumbprint -eq $Thumbprint }
        if ($cert) {
            return $cert
        }
        Write-Err "Certificate with thumbprint '$Thumbprint' not found"
        return $null
    }
    
    # Priority 3: Find HALT self-signed certificate
    Write-Info "Looking for HALT code signing certificate..."
    $cert = Get-ChildItem $CertStorePath -CodeSigningCert | 
    Where-Object { $_.Subject -like "*$CertName*" } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
    
    if ($cert) {
        Write-Success "Found certificate: $($cert.Subject)"
        Write-Info "Thumbprint: $($cert.Thumbprint)"
        Write-Info "Expires: $($cert.NotAfter)"
        return $cert
    }
    
    Write-Warn "No HALT code signing certificate found."
    Write-Info "Run '.\Sign-Halt.ps1 -Action create-cert' to create one."
    return $null
}

function New-SelfSignedCodeSigningCert {
    Write-Host ""
    Write-Host "Creating Self-Signed Code Signing Certificate" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host ""
    
    # Check for existing certificate
    $existingCert = Get-ChildItem $CertStorePath -CodeSigningCert | 
    Where-Object { $_.Subject -like "*$CertName*" }
    
    if ($existingCert) {
        Write-Warn "An HALT code signing certificate already exists:"
        Write-Info "Subject: $($existingCert.Subject)"
        Write-Info "Thumbprint: $($existingCert.Thumbprint)"
        Write-Info "Expires: $($existingCert.NotAfter)"
        Write-Host ""
        $response = Read-Host "Do you want to create a new one? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            Write-Info "Keeping existing certificate."
            return $existingCert
        }
    }
    
    Write-Info "Creating new self-signed code signing certificate..."
    
    try {
        # Create the certificate
        $cert = New-SelfSignedCertificate `
            -Subject "CN=$CertName, O=HALT Team, L=Local, C=US" `
            -Type CodeSigningCert `
            -KeySpec Signature `
            -KeyUsage DigitalSignature `
            -KeyAlgorithm RSA `
            -KeyLength 4096 `
            -HashAlgorithm SHA256 `
            -CertStoreLocation $CertStorePath `
            -NotAfter (Get-Date).AddYears(5) `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
        
        Write-Success "Certificate created successfully!"
        Write-Host ""
        Write-Host "Certificate Details:" -ForegroundColor Cyan
        Write-Host "  Subject:    $($cert.Subject)"
        Write-Host "  Thumbprint: $($cert.Thumbprint)"
        Write-Host "  Expires:    $($cert.NotAfter)"
        Write-Host ""
        
        # Export options
        Write-Host "Next Steps:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "1. To sign files, run:" -ForegroundColor Cyan
        Write-Host "   .\Sign-Halt.ps1 -Action sign -SignAll"
        Write-Host ""
        Write-Host "2. To trust this certificate on your machine:" -ForegroundColor Cyan
        Write-Host "   - Open 'certmgr.msc' (Certificate Manager)"
        Write-Host "   - Navigate to: Personal > Certificates"
        Write-Host "   - Find '$CertName'"
        Write-Host "   - Right-click > All Tasks > Export..."
        Write-Host "   - Export to a .cer file (no private key)"
        Write-Host "   - Import the .cer to 'Trusted Publishers' store"
        Write-Host ""
        Write-Host "3. To export for other machines:" -ForegroundColor Cyan
        Write-Host "   Export-PfxCertificate -Cert 'Cert:\CurrentUser\My\$($cert.Thumbprint)' -FilePath 'halt-signing.pfx' -Password (ConvertTo-SecureString 'YourPassword' -AsPlainText -Force)"
        Write-Host ""
        
        return $cert
    }
    catch {
        Write-Err "Failed to create certificate: $_"
        return $null
    }
}

function Add-CodeSignature {
    param(
        [string]$FilePath,
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [string]$Timestamp
    )
    
    $fileName = Split-Path -Leaf $FilePath
    Write-Info "Signing: $fileName"
    
    # Check if already signed
    $existingSig = Get-AuthenticodeSignature -FilePath $FilePath
    if ($existingSig.Status -eq "Valid") {
        Write-Warn "  Already signed by: $($existingSig.SignerCertificate.Subject)"
        $response = Read-Host "  Re-sign? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            return $true
        }
    }
    
    try {
        # Sign the file
        $sigParams = @{
            FilePath      = $FilePath
            Certificate   = $Certificate
            HashAlgorithm = "SHA256"
        }
        
        # Add timestamp if available
        if ($Timestamp) {
            $sigParams.TimestampServer = $Timestamp
        }
        
        $result = Set-AuthenticodeSignature @sigParams
        
        if ($result.Status -eq "Valid") {
            Write-Success "  Signed successfully"
            return $true
        }
        else {
            Write-Err "  Signing failed: $($result.StatusMessage)"
            return $false
        }
    }
    catch {
        Write-Err "  Error signing file: $_"
        return $false
    }
}

function Invoke-SignFiles {
    param(
        [string[]]$Files,
        [switch]$All
    )
    
    Write-Host ""
    Write-Host "HALT Code Signing" -ForegroundColor Green
    Write-Host "===================" -ForegroundColor Green
    Write-Host ""
    
    # Get certificate
    $cert = Get-SigningCertificate -Path $CertificatePath -Thumbprint $CertificateThumbprint -Password $CertificatePassword
    if (-not $cert) {
        Write-Err "No signing certificate available. Aborting."
        return $false
    }
    
    # Determine files to sign
    $filesToProcess = @()
    
    if ($All) {
        Write-Info "Collecting all signable files..."
        
        # PowerShell scripts
        $filesToProcess += Get-ChildItem -Path $ScriptDir -Filter "*.ps1" -Recurse
        
        # Batch files
        $filesToProcess += Get-ChildItem -Path $ScriptDir -Filter "*.bat" -Recurse
        
        # Executables in dist folder
        $distPath = Join-Path (Split-Path $ScriptDir -Parent) "dist"
        if (Test-Path $distPath) {
            $filesToProcess += Get-ChildItem -Path $distPath -Filter "*.exe" -Recurse
        }
        
        # Also check parent dist folder
        $parentDistPath = Join-Path (Split-Path (Split-Path $ScriptDir -Parent) -Parent) "dist"
        if (Test-Path $parentDistPath) {
            $filesToProcess += Get-ChildItem -Path $parentDistPath -Filter "*.exe" -Recurse
        }
    }
    else {
        foreach ($file in $Files) {
            $fullPath = if ([System.IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $ScriptDir $file }
            if (Test-Path $fullPath) {
                $filesToProcess += Get-Item $fullPath
            }
            else {
                Write-Warn "File not found: $file"
            }
        }
    }
    
    if ($filesToProcess.Count -eq 0) {
        Write-Warn "No files found to sign."
        return $true
    }
    
    Write-Info "Found $($filesToProcess.Count) file(s) to sign"
    Write-Host ""
    
    # Sign each file
    $successCount = 0
    $failCount = 0
    
    foreach ($file in $filesToProcess) {
        if (Add-CodeSignature -FilePath $file.FullName -Certificate $cert -Timestamp $TimestampServer) {
            $successCount++
        }
        else {
            $failCount++
        }
    }
    
    Write-Host ""
    Write-Host "Signing Complete" -ForegroundColor Green
    Write-Host "  Successful: $successCount"
    if ($failCount -gt 0) {
        Write-Host "  Failed: $failCount" -ForegroundColor Red
    }
    Write-Host ""
    
    return ($failCount -eq 0)
}

function Test-Signatures {
    param(
        [string[]]$Files,
        [switch]$All
    )
    
    Write-Host ""
    Write-Host "Verifying Code Signatures" -ForegroundColor Green
    Write-Host "=========================" -ForegroundColor Green
    Write-Host ""
    
    # Determine files to verify
    $filesToCheck = @()
    
    if ($All) {
        $filesToCheck += Get-ChildItem -Path $ScriptDir -Filter "*.ps1" -Recurse
        $filesToCheck += Get-ChildItem -Path $ScriptDir -Filter "*.bat" -Recurse
        
        $distPath = Join-Path (Split-Path $ScriptDir -Parent) "dist"
        if (Test-Path $distPath) {
            $filesToCheck += Get-ChildItem -Path $distPath -Filter "*.exe" -Recurse
        }
    }
    else {
        foreach ($file in $Files) {
            $fullPath = if ([System.IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $ScriptDir $file }
            if (Test-Path $fullPath) {
                $filesToCheck += Get-Item $fullPath
            }
        }
    }
    
    if ($filesToCheck.Count -eq 0) {
        Write-Warn "No files found to verify."
        return
    }
    
    $results = @()
    
    foreach ($file in $filesToCheck) {
        $sig = Get-AuthenticodeSignature -FilePath $file.FullName
        $fileName = Split-Path -Leaf $file.FullName
        
        $statusColor = switch ($sig.Status) {
            "Valid" { "Green" }
            "NotSigned" { "Yellow" }
            default { "Red" }
        }
        
        $statusIcon = switch ($sig.Status) {
            "Valid" { "[SIGNED]" }
            "NotSigned" { "[NOT SIGNED]" }
            default { "[INVALID]" }
        }
        
        Write-Host "$statusIcon $fileName" -ForegroundColor $statusColor -NoNewline
        Write-Host " - $($sig.Status)" -ForegroundColor $statusColor
        
        if ($sig.Status -eq "Valid") {
            Write-Host "   Signer: $($sig.SignerCertificate.Subject)" -ForegroundColor Gray
        }
        
        $results += [PSCustomObject]@{
            File   = $fileName
            Status = $sig.Status
            Signer = $sig.SignerCertificate.Subject
        }
    }
    
    Write-Host ""
    $validCount = ($results | Where-Object { $_.Status -eq "Valid" }).Count
    $totalCount = $results.Count
    Write-Host "Summary: $validCount of $totalCount files are properly signed"
    Write-Host ""
}

# Main execution
if ($Help -or $Action -eq "help") {
    Show-SigningHelp
    exit 0
}

switch ($Action) {
    "create-cert" {
        $cert = New-SelfSignedCodeSigningCert
        if (-not $cert) {
            exit 1
        }
    }
    "sign" {
        if (-not (Invoke-SignFiles -Files $FilesToSign -All:$SignAll)) {
            exit 1
        }
    }
    "verify" {
        Test-Signatures -Files $FilesToSign -All:$SignAll
    }
    default {
        Write-Err "Unknown action: $Action"
        Show-SigningHelp
        exit 1
    }
}
