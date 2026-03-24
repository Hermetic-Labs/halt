# HALT Windows Production Installer
# Master script that builds the complete Windows distribution package
# Combines: Electron Launcher + Docker Stack + Backend Executable

param(
    [ValidateSet("all", "electron", "docker", "backend", "validate", "clean")]
    [string]$Action = "all",
    
    [switch]$SkipElectron,
    [switch]$SkipDocker,
    [switch]$IncludeModels,
    [string]$Version = "1.0.0",
    
    # Code signing options
    [switch]$SignOutput,
    [string]$CertificatePath = ""
)

# =============================================================================
# CONFIGURATION
# =============================================================================

$Config = @{
    Version       = $Version
    ProductName   = "HALT"
    Publisher     = "Hermetic Labs"
    
    # Paths
    RepoRoot      = (Get-Item "$PSScriptRoot\..\..").FullName
    ElectronDir   = "$PSScriptRoot\..\electron-launcher"
    BackendDir    = "$PSScriptRoot\..\..\backend"
    FrontendDir   = "$PSScriptRoot\..\..\frontend"
    OpsDir        = "$PSScriptRoot\..\..\ops"
    DistDir       = "$PSScriptRoot\dist"
    
    # Output
    InstallerName = "HALT-Setup-$Version.exe"
    PortableName  = "HALT-Portable-$Version.zip"
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

function Write-Step {
    param([string]$Message, [string]$Type = "info")
    
    switch ($Type) {
        "success" { Write-Host "✅ $Message" -ForegroundColor Green }
        "error" { Write-Host "❌ $Message" -ForegroundColor Red }
        "warning" { Write-Host "⚠️  $Message" -ForegroundColor Yellow }
        "info" { Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
        "step" { Write-Host "▶️  $Message" -ForegroundColor Blue }
        default { Write-Host $Message }
    }
}

function Write-Banner {
    param([string]$Title)
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor White
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Prerequisites {
    Write-Step "Checking prerequisites..." "step"
    
    $missing = @()
    
    # Node.js
    try {
        $nodeVersion = node --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Node.js: $nodeVersion" "success"
        }
        else { throw }
    }
    catch {
        $missing += "Node.js (https://nodejs.org/)"
    }
    
    # npm
    try {
        $npmVersion = npm --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "npm: $npmVersion" "success"
        }
        else { throw }
    }
    catch {
        $missing += "npm (comes with Node.js)"
    }
    
    # Docker (optional for Electron-only build)
    try {
        $dockerVersion = docker --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Docker: $dockerVersion" "success"
        }
        else { throw }
    }
    catch {
        Write-Step "Docker not found (optional for Electron build)" "warning"
    }
    
    # Python (for backend build)
    try {
        $pythonVersion = python --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Python: $pythonVersion" "success"
        }
        else { throw }
    }
    catch {
        Write-Step "Python not found (optional)" "warning"
    }
    
    if ($missing.Count -gt 0) {
        Write-Step "Missing required tools:" "error"
        $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        return $false
    }
    
    return $true
}

# =============================================================================
# BUILD FUNCTIONS
# =============================================================================

function Build-ElectronApp {
    Write-Banner "Building Electron Launcher"
    
    if ($SkipElectron) {
        Write-Step "Skipping Electron build (--SkipElectron)" "info"
        return $true
    }
    
    $electronDir = $Config.ElectronDir
    
    if (-not (Test-Path $electronDir)) {
        Write-Step "Electron launcher not found at: $electronDir" "error"
        return $false
    }
    
    try {
        Push-Location $electronDir
        
        # Install dependencies
        Write-Step "Installing Electron dependencies..." "step"
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        
        # Build for Windows
        Write-Step "Building Windows installer..." "step"
        npm run build:win
        if ($LASTEXITCODE -ne 0) { throw "Electron build failed" }
        
        # Check output
        $distPath = "$electronDir\dist"
        $exeFiles = Get-ChildItem -Path $distPath -Filter "*.exe" -ErrorAction SilentlyContinue
        
        if ($exeFiles.Count -gt 0) {
            Write-Step "Electron build complete: $($exeFiles[0].Name)" "success"
            
            # Copy to output
            if (-not (Test-Path $Config.DistDir)) {
                New-Item -ItemType Directory -Path $Config.DistDir -Force | Out-Null
            }
            Copy-Item "$distPath\*.exe" $Config.DistDir -Force
        }
        else {
            throw "No EXE file found in dist"
        }
        
        return $true
    }
    catch {
        Write-Step "Electron build failed: $_" "error"
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-DockerStack {
    Write-Banner "Building Docker Stack"
    
    if ($SkipDocker) {
        Write-Step "Skipping Docker build (--SkipDocker)" "info"
        return $true
    }
    
    $opsDir = $Config.OpsDir
    $composeFile = "$opsDir\docker-compose.yml"
    
    if (-not (Test-Path $composeFile)) {
        Write-Step "docker-compose.yml not found at: $composeFile" "error"
        return $false
    }
    
    try {
        Push-Location $opsDir
        
        # Build images
        Write-Step "Building Docker images..." "step"
        docker-compose -f docker-compose.yml build
        if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
        
        Write-Step "Docker images built successfully" "success"
        return $true
    }
    catch {
        Write-Step "Docker build failed: $_" "error"
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-BackendExecutable {
    Write-Banner "Building Backend Executable"
    
    $buildScript = "$PSScriptRoot\Build-Halt.exe.ps1"
    
    if (-not (Test-Path $buildScript)) {
        Write-Step "Build script not found: $buildScript" "warning"
        Write-Step "Skipping standalone backend build" "info"
        return $true
    }
    
    try {
        Write-Step "Running backend build script..." "step"
        & $buildScript -Action build
        
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Backend executable built successfully" "success"
            return $true
        }
        else {
            throw "Build script returned error"
        }
    }
    catch {
        Write-Step "Backend build failed: $_" "error"
        return $false
    }
}

function Validate-Package {
    Write-Banner "Validating Package"
    
    $validateScript = "$PSScriptRoot\Validate-WindowsPackage.ps1"
    
    if (-not (Test-Path $validateScript)) {
        Write-Step "Validation script not found" "warning"
        return $true
    }
    
    try {
        & $validateScript
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        Write-Step "Validation failed: $_" "error"
        return $false
    }
}

function Clean-BuildArtifacts {
    Write-Banner "Cleaning Build Artifacts"
    
    $cleanPaths = @(
        "$($Config.ElectronDir)\dist",
        "$($Config.ElectronDir)\node_modules",
        "$($Config.DistDir)",
        "$PSScriptRoot\build",
        "$PSScriptRoot\dist"
    )
    
    foreach ($path in $cleanPaths) {
        if (Test-Path $path) {
            Write-Step "Removing: $path" "step"
            Remove-Item -Path $path -Recurse -Force
        }
    }
    
    Write-Step "Clean complete" "success"
    return $true
}

function Create-DistributionPackage {
    Write-Banner "Creating Distribution Package"
    
    $distDir = $Config.DistDir
    if (-not (Test-Path $distDir)) {
        New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    }
    
    # Create package info
    $packageInfo = @"
HALT - Medical AI Platform
Version: $($Config.Version)
Publisher: $($Config.Publisher)
Build Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

Contents:
- HALT-Setup.exe - Windows installer (includes Docker integration)
- docker-compose.yml - Docker orchestration file
- README.txt - Installation instructions

System Requirements:
- Windows 10/11 (64-bit)
- 8 GB RAM minimum
- 4 GB free disk space
- Docker Desktop (installed automatically if needed)

Quick Start:
1. Run HALT-Setup.exe as Administrator
2. Follow the installation wizard
3. HALT will start automatically
4. Open http://localhost in your browser

Support: https://docs.halt.com
"@
    
    $packageInfo | Out-File "$distDir\README.txt" -Encoding UTF8
    
    # Copy docker-compose for standalone users
    if (Test-Path "$($Config.OpsDir)\docker-compose.yml") {
        Copy-Item "$($Config.OpsDir)\docker-compose.yml" "$distDir\" -Force
    }
    
    Write-Step "Distribution package created at: $distDir" "success"
    return $true
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║             HALT Windows Production Builder                 ║" -ForegroundColor Cyan
Write-Host "║                   Hermetic Labs © 2025                       ║" -ForegroundColor DarkCyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

switch ($Action) {
    "all" {
        Write-Step "Building complete Windows distribution..." "step"
        
        if (-not (Test-Prerequisites)) {
            Write-Step "Prerequisites check failed" "error"
            exit 1
        }
        
        $success = $true
        
        # Build Electron launcher
        if (-not (Build-ElectronApp)) {
            $success = $false
        }
        
        # Build Docker stack
        if ($success -and -not (Build-DockerStack)) {
            Write-Step "Docker build failed, continuing..." "warning"
        }
        
        # Create distribution package
        if ($success) {
            Create-DistributionPackage
        }
        
        if ($success) {
            Write-Host ""
            Write-Step "BUILD COMPLETE!" "success"
            Write-Host ""
            Write-Host "Output: $($Config.DistDir)" -ForegroundColor Green
            
            # Sign output if requested
            if ($SignOutput) {
                Write-Host ""
                Write-Step "Signing build artifacts..." "step"
                $signScript = "$PSScriptRoot\Sign-Halt.ps1"
                if (Test-Path $signScript) {
                    $signArgs = @("-Action", "sign", "-SignAll")
                    if ($CertificatePath) {
                        $signArgs += @("-CertificatePath", $CertificatePath)
                    }
                    & $signScript @signArgs
                    if ($LASTEXITCODE -eq 0) {
                        Write-Step "All artifacts signed successfully" "success"
                    }
                    else {
                        Write-Step "Signing completed with some warnings" "warning"
                    }
                }
                else {
                    Write-Step "Sign-Halt.ps1 not found, skipping signing" "warning"
                }
            }
            else {
                Write-Host ""
                Write-Step "Tip: Add -SignOutput to sign for Windows Smart App Control trust" "info"
            }
            Write-Host ""
        }
        else {
            Write-Step "BUILD FAILED" "error"
            exit 1
        }
    }
    
    "electron" {
        if (-not (Test-Prerequisites)) { exit 1 }
        Build-ElectronApp
    }
    
    "docker" {
        if (-not (Test-Prerequisites)) { exit 1 }
        Build-DockerStack
    }
    
    "backend" {
        if (-not (Test-Prerequisites)) { exit 1 }
        Build-BackendExecutable
    }
    
    "validate" {
        Validate-Package
    }
    
    "clean" {
        Clean-BuildArtifacts
    }
}
