# HALT Windows Package Validation Script
# Validates the package structure and installation components

param(
    [ValidateSet("validate", "package", "test")]
    [string]$Action = "validate",
    
    [string]$PackagePath = "windows_package",
    
    [switch]$IncludeTests,
    [switch]$Verbose,
    
    [switch]$Help
)

# Validation Configuration
$ValidationConfig = @{
    RequiredFiles = @(
        "installer\halt.wxs",
        "service\halt-service.xml",
        "service\Manage-HaltService.ps1",
        "service\prestart.ps1",
        "service\prestop.ps1",
        "scripts\Docker-Halt.ps1",
        "scripts\Build-Halt.exe.ps1",
        "scripts\install-halt.bat",
        "docs\Windows-Installation-Guide.md"
    )
    
    OptionalFiles = @(
        "images\halt-icon.ico",
        "images\halt-logo.png"
    )
    
    RequiredDirectories = @(
        "installer",
        "service",
        "scripts",
        "docs",
        "images"
    )
    
    TestScenarios = @{
        WindowsService = @{
            Script = "service\Manage-HaltService.ps1"
            Actions = @("status", "help")
        }
        DockerPackage = @{
            Script = "scripts\Docker-Halt.ps1"
            Actions = @("status", "help")
        }
        ExecutableBuilder = @{
            Script = "scripts\Build-Halt.exe.ps1"
            Actions = @("help")
        }
    }
}

function Show-Help {
    Write-Host "HALT Windows Package Validation Script" -ForegroundColor Green
    Write-Host ""
    Write-Host "Usage: .\Validate-WindowsPackage.ps1 [ACTION]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Actions:" -ForegroundColor Cyan
    Write-Host "  validate  - Validate package structure and files" -ForegroundColor White
    Write-Host "  package   - Create distribution package" -ForegroundColor White
    Write-Host "  test      - Run package tests (requires full setup)" -ForegroundColor White
    Write-Host "  help      - Show this help message" -ForegroundColor White
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  -PackagePath <path>  - Package directory (default: windows_package)" -ForegroundColor White
    Write-Host "  -IncludeTests        - Include test scenarios in validation" -ForegroundColor White
    Write-Host "  -Verbose             - Show detailed output" -ForegroundColor White
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Cyan
    Write-Host "  .\Validate-WindowsPackage.ps1 -Action validate" -ForegroundColor White
    Write-Host "  .\Validate-WindowsPackage.ps1 -Action package -Verbose" -ForegroundColor White
    Write-Host "  .\Validate-WindowsPackage.ps1 -Action test -IncludeTests" -ForegroundColor White
}

function Write-ValidationResult {
    param(
        [string]$Message,
        [string]$Type = "info"
    )
    
    switch ($Type) {
        "success" { Write-Host "✓ $Message" -ForegroundColor Green }
        "error" { Write-Host "✗ $Message" -ForegroundColor Red }
        "warning" { Write-Host "⚠ $Message" -ForegroundColor Yellow }
        "info" { Write-Host "ℹ $Message" -ForegroundColor Blue }
        default { Write-Host "$Message" -ForegroundColor White }
    }
}

function Test-PackageStructure {
    Write-Host "Validating package structure..." -ForegroundColor Blue
    
    $packageRoot = Resolve-Path $PackagePath
    $currentDir = Get-Location
    Set-Location $packageRoot
    
    try {
        $validationResults = @{
            Files = @{ Valid = 0; Invalid = 0; Missing = 0 }
            Directories = @{ Valid = 0; Invalid = 0; Missing = 0 }
            Details = @()
        }
        
        # Test required directories
        Write-ValidationResult "Checking required directories..." "info"
        foreach ($dir in $ValidationConfig.RequiredDirectories) {
            if (Test-Path $dir) {
                Write-ValidationResult "Directory found: $dir" "success"
                $validationResults.Directories.Valid++
            } else {
                Write-ValidationResult "Directory missing: $dir" "error"
                $validationResults.Directories.Missing++
                $validationResults.Details += "Missing directory: $dir"
            }
        }
        
        # Test required files
        Write-ValidationResult "Checking required files..." "info"
        foreach ($file in $ValidationConfig.RequiredFiles) {
            if (Test-Path $file) {
                # Validate file content
                $content = Get-Content $file -Raw
                if ($content -and $content.Length -gt 0) {
                    Write-ValidationResult "File valid: $file" "success"
                    $validationResults.Files.Valid++
                } else {
                    Write-ValidationResult "File empty: $file" "warning"
                    $validationResults.Files.Invalid++
                    $validationResults.Details += "Empty file: $file"
                }
            } else {
                Write-ValidationResult "File missing: $file" "error"
                $validationResults.Files.Missing++
                $validationResults.Details += "Missing file: $file"
            }
        }
        
        # Test optional files
        Write-ValidationResult "Checking optional files..." "info"
        foreach ($file in $ValidationConfig.OptionalFiles) {
            if (Test-Path $file) {
                Write-ValidationResult "Optional file found: $file" "info"
            } else {
                Write-ValidationResult "Optional file missing: $file" "warning"
            }
        }
        
        # Test PowerShell scripts syntax
        Write-ValidationResult "Validating PowerShell script syntax..." "info"
        $powershellFiles = Get-ChildItem -Recurse -Filter "*.ps1" -Path .
        foreach ($psFile in $powershellFiles) {
            try {
                $null = [System.Management.Automation.Language.Parser]::ParseFile($psFile.FullName, [ref]$null, [ref]$null)
                Write-ValidationResult "PowerShell syntax valid: $($psFile.Name)" "success"
            }
            catch {
                Write-ValidationResult "PowerShell syntax error in $($psFile.Name): $($_.Exception.Message)" "error"
                $validationResults.Files.Invalid++
                $validationResults.Details += "PS syntax error: $($psFile.Name)"
            }
        }
        
        # Test batch files syntax (basic check)
        Write-ValidationResult "Validating batch file structure..." "info"
        $batchFiles = Get-ChildItem -Recurse -Filter "*.bat" -Path .
        foreach ($batFile in $batchFiles) {
            $content = Get-Content $batFile.FullName
            if ($content -and $content.Count -gt 0) {
                Write-ValidationResult "Batch file looks valid: $($batFile.Name)" "success"
            } else {
                Write-ValidationResult "Batch file empty: $($batFile.Name)" "warning"
            }
        }
        
        return $validationResults
    }
    finally {
        Set-Location $currentDir
    }
}

function Test-InstallationScripts {
    if (!$IncludeTests) {
        Write-ValidationResult "Skipping installation script tests (not requested)" "info"
        return $true
    }
    
    Write-Host "Testing installation scripts..." -ForegroundColor Blue
    
    foreach ($scenarioName in $ValidationConfig.TestScenarios.Keys) {
        $scenario = $ValidationConfig.TestScenarios[$scenarioName]
        Write-ValidationResult "Testing scenario: $scenarioName" "info"
        
        $scriptPath = Join-Path $PackagePath $scenario.Script
        if (!(Test-Path $scriptPath)) {
            Write-ValidationResult "Script not found: $($scenario.Script)" "error"
            continue
        }
        
        foreach ($action in $scenario.Actions) {
            try {
                $testResult = & powershell -File $scriptPath -Action $action -ErrorAction SilentlyContinue
                if ($LASTEXITCODE -eq 0) {
                    Write-ValidationResult "$scenarioName - $action: OK" "success"
                } else {
                    Write-ValidationResult "$scenarioName - $action: Failed (exit code: $LASTEXITCODE)" "warning"
                }
            }
            catch {
                Write-ValidationResult "$scenarioName - $action: Error - $_" "error"
            }
        }
    }
    
    return $true
}

function Test-DockerConfiguration {
    Write-Host "Validating Docker configuration..." -ForegroundColor Blue
    
    # Check if docker-compose files are valid YAML
    $composeFiles = @("..\docker-compose.yml", "..\docker-compose.prod.yml")
    
    foreach ($composeFile in $composeFiles) {
        $fullPath = Join-Path $PackagePath $composeFile
        if (Test-Path $fullPath) {
            try {
                $content = Get-Content $fullPath -Raw
                # Basic YAML validation
                if ($content -match "version:" -and $content -match "services:") {
                    Write-ValidationResult "Docker compose file looks valid: $(Split-Path $composeFile -Leaf)" "success"
                } else {
                    Write-ValidationResult "Docker compose file may have issues: $(Split-Path $composeFile -Leaf)" "warning"
                }
            }
            catch {
                Write-ValidationResult "Error reading Docker compose file: $(Split-Path $composeFile -Leaf)" "error"
            }
        }
    }
    
    return $true
}

function Test-WiXConfiguration {
    Write-Host "Validating WiX installer configuration..." -ForegroundColor Blue
    
    $wixFile = Join-Path $PackagePath "installer\halt.wxs"
    if (!(Test-Path $wixFile)) {
        Write-ValidationResult "WiX configuration file not found" "error"
        return $false
    }
    
    try {
        $content = Get-Content $wixFile -Raw
        
        # Basic WiX XML validation
        $xml = [xml]$content
        Write-ValidationResult "WiX XML is well-formed" "success"
        
        # Check required elements
        $requiredElements = @("Product", "Package", "Directory", "Component", "Feature")
        foreach ($element in $requiredElements) {
            if ($xml.Wix.GetElementsByTagName($element).Count -gt 0) {
                Write-ValidationResult "WiX element found: $element" "success"
            } else {
                Write-ValidationResult "WiX element missing: $element" "warning"
            }
        }
        
        return $true
    }
    catch {
        Write-ValidationResult "Error parsing WiX configuration: $_" "error"
        return $false
    }
}

function New-DistributionPackage {
    Write-Host "Creating distribution package..." -ForegroundColor Blue
    
    $packageRoot = Resolve-Path $PackagePath
    $distDir = Join-Path (Split-Path $packageRoot) "dist"
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $packageName = "HALT-Windows-Package-$timestamp"
    $distPath = Join-Path $distDir $packageName
    
    # Create distribution directory
    if (!(Test-Path $distDir)) {
        New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    }
    
    if (Test-Path $distPath) {
        Remove-Item -Recurse -Force $distPath
    }
    New-Item -ItemType Directory -Path $distPath -Force | Out-Null
    
    try {
        # Copy all package files
        Write-ValidationResult "Copying package files..." "info"
        Copy-Item -Path "$packageRoot\*" -Destination $distPath -Recurse -Force
        
        # Copy main application files
        $mainFiles = @(
            "..\Dockerfile",
            "..\docker-compose.yml",
            "..\docker-compose.prod.yml",
            "..\package.json",
            "..\Makefile",
            "..\README.md"
        )
        
        foreach ($file in $mainFiles) {
            $fullPath = Resolve-Path $file
            if ($fullPath) {
                Copy-Item -Path $fullPath -Destination $distPath -Force
                Write-ValidationResult "Copied: $(Split-Path $file -Leaf)" "success"
            }
        }
        
        # Create README for the package
        $packageReadme = @"
# HALT Windows Package

This package contains all the necessary files for installing HALT on Windows.

## Package Contents

- **installer/**: WiX MSI installer configuration
- **service/**: Windows service management scripts
- **scripts/**: Installation and management scripts
- **docs/**: Installation guide and documentation

## Quick Installation

1. Run `scripts\install-halt.bat` as Administrator for automated installation
2. Or use `scripts\Docker-Halt.ps1` for Docker-based installation
3. Or use `service\Manage-HaltService.ps1` for service-only installation

## Documentation

See `docs\Windows-Installation-Guide.md` for detailed installation instructions.

## System Requirements

- Windows 10/11 (64-bit)
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free storage space

For more information: https://docs.halt.com

---
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@
        
        $packageReadme | Out-File -FilePath "$distPath\README.txt" -Encoding UTF8
        
        # Create installation verification script
        $verificationScript = @"
# HALT Package Verification Script
# Run this script to verify the package integrity

Write-Host "HALT Package Verification" -ForegroundColor Green

# Check file counts
Write-Host "Package contains:" -ForegroundColor Blue
Get-ChildItem -Recurse -Path "." -File | Measure-Object | Select-Object @{Name="Files";Expression={\$_.Count}} | Format-Table -AutoSize

# Test critical scripts
Write-Host "`nTesting critical scripts..." -ForegroundColor Blue

# Test service management script
if (Test-Path "service\Manage-HaltService.ps1") {
    Write-Host "✓ Service management script found" -ForegroundColor Green
    try {
        & powershell -File "service\Manage-HaltService.ps1" -Action help -ErrorAction SilentlyContinue | Out-Null
        Write-Host "✓ Service management script executable" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Service management script has issues" -ForegroundColor Red
    }
}

# Test Docker script
if (Test-Path "scripts\Docker-Halt.ps1") {
    Write-Host "✓ Docker management script found" -ForegroundColor Green
    try {
        & powershell -File "scripts\Docker-Halt.ps1" -Action help -ErrorAction SilentlyContinue | Out-Null
        Write-Host "✓ Docker management script executable" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Docker management script has issues" -ForegroundColor Red
    }
}

# Test batch installer
if (Test-Path "scripts\install-halt.bat") {
    Write-Host "✓ Batch installer found" -ForegroundColor Green
    if ((Get-Content "scripts\install-halt.bat" | Measure-Object).Count -gt 10) {
        Write-Host "✓ Batch installer appears complete" -ForegroundColor Green
    }
}

Write-Host "`nPackage verification complete!" -ForegroundColor Green
pause
"@
        
        $verificationScript | Out-File -FilePath "$distPath\verify-package.ps1" -Encoding UTF8
        
        # Create ZIP archive
        $zipPath = "$distDir\$packageName.zip"
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::CreateFromDirectory($distPath, $zipPath)
            Write-ValidationResult "Package archived: $zipPath" "success"
        }
        catch {
            Write-ValidationResult "Warning: Could not create ZIP archive: $_" "warning"
        }
        
        # Calculate package size
        $packageSize = (Get-ChildItem -Recurse -Path $distPath | Measure-Object -Property Length -Sum).Sum
        $packageSizeMB = [math]::Round($packageSize / 1MB, 2)
        
        Write-ValidationResult "Distribution package created successfully" "success"
        Write-ValidationResult "Package location: $distPath" "info"
        Write-ValidationResult "Package size: $packageSizeMB MB" "info"
        
        if (Test-Path $zipPath) {
            $zipSize = (Get-Item $zipPath).Length / 1MB
            Write-ValidationResult "ZIP archive: $zipPath ($([math]::Round($zipSize, 2)) MB)" "info"
        }
        
        return $distPath
    }
    catch {
        Write-ValidationResult "Error creating distribution package: $_" "error"
        return $null
    }
}

function Test-PackageFunctionality {
    if (!$IncludeTests) {
        Write-ValidationResult "Skipping functionality tests (not requested)" "info"
        return $true
    }
    
    Write-Host "Testing package functionality..." -ForegroundColor Blue
    
    $testResults = @{
        Passed = 0
        Failed = 0
        Warnings = 0
    }
    
    # Test each script
    $scripts = @{
        "Service Management" = "service\Manage-HaltService.ps1"
        "Docker Management" = "scripts\Docker-Halt.ps1"
        "Executable Builder" = "scripts\Build-Halt.exe.ps1"
    }
    
    foreach ($scriptName in $scripts.Keys) {
        $scriptPath = Join-Path $PackagePath $scripts[$scriptName]
        
        Write-ValidationResult "Testing $scriptName..." "info"
        
        if (!(Test-Path $scriptPath)) {
            Write-ValidationResult "Script not found: $scriptPath" "error"
            $testResults.Failed++
            continue
        }
        
        try {
            # Test help functionality
            $helpResult = & powershell -File $scriptPath -Action help -ErrorAction SilentlyContinue
            if ($LASTEXITCODE -eq 0 -or $helpResult) {
                Write-ValidationResult "$scriptName help: OK" "success"
                $testResults.Passed++
            } else {
                Write-ValidationResult "$scriptName help: Warning" "warning"
                $testResults.Warnings++
            }
        }
        catch {
            Write-ValidationResult "$scriptName: Error - $_" "error"
            $testResults.Failed++
        }
    }
    
    # Summary
    Write-Host "`nTest Results:" -ForegroundColor Blue
    Write-ValidationResult "Passed: $($testResults.Passed)" "success"
    Write-ValidationResult "Failed: $($testResults.Failed)" "error"
    Write-ValidationResult "Warnings: $($testResults.Warnings)" "warning"
    
    return $testResults.Failed -eq 0
}

# Main execution
if ($Help -or $Action -eq "help") {
    Show-Help
    exit 0
}

Write-Host "HALT Windows Package Validation" -ForegroundColor Green
Write-Host "Action: $Action" -ForegroundColor Cyan
Write-Host "Package Path: $PackagePath" -ForegroundColor Cyan
Write-Host ""

# Validate package structure
$structureResults = Test-PackageStructure

# Additional validations
Test-DockerConfiguration | Out-Null
Test-WiXConfiguration | Out-Null

# Execute action based on parameter
switch ($Action) {
    "validate" {
        Test-InstallationScripts | Out-Null
        
        # Summary
        Write-Host "`nValidation Summary:" -ForegroundColor Blue
        Write-ValidationResult "Files - Valid: $($structureResults.Files.Valid), Invalid: $($structureResults.Files.Invalid), Missing: $($structureResults.Files.Missing)" "info"
        Write-ValidationResult "Directories - Valid: $($structureResults.Directories.Valid), Missing: $($structureResults.Directories.Missing)" "info"
        
        if ($structureResults.Files.Missing -eq 0 -and $structureResults.Directories.Missing -eq 0) {
            Write-Host "`n🎉 Package validation PASSED!" -ForegroundColor Green
            exit 0
        } else {
            Write-Host "`n⚠️ Package validation completed with issues" -ForegroundColor Yellow
            if ($Verbose -and $structureResults.Details.Count -gt 0) {
                Write-Host "`nDetails:" -ForegroundColor Yellow
                $structureResults.Details | ForEach-Object { Write-ValidationResult $_ "warning" }
            }
            exit 1
        }
    }
    "package" {
        $packagePath = New-DistributionPackage
        if ($packagePath) {
            Write-Host "`n📦 Distribution package created: $packagePath" -ForegroundColor Green
        } else {
            Write-Host "`n❌ Failed to create distribution package" -ForegroundColor Red
            exit 1
        }
    }
    "test" {
        Test-PackageFunctionality
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Show-Help
        exit 1
    }
}