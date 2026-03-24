# HALT Windows Executable Builder
# Creates a standalone Windows executable for the HALT backend

param(
    [ValidateSet("build", "clean", "test")]
    [string]$Action = "build",
    
    [string]$BuildDir = "build",
    [string]$DistDir = "dist",
    
    [switch]$IncludeModels,
    [switch]$IncludeFrontend,
    
    [string]$AppName = "EVEOS",
    [string]$Version = "1.0.0",
    
    # Code signing options
    [switch]$SignOutput,
    [string]$CertificatePath = "",
    
    [switch]$Help
)

# Configuration
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $ProjectRoot

$Config = @{
    PythonVersion  = "3.11"
    BackendDir     = "backend"
    FrontendDir    = "frontend"
    CoreDir        = "core"
    ToolsDir       = "tools"
    DataDir        = "data"
    
    # Executable settings
    ExecutableName = "EVEOS.exe"
    IconPath       = "windows_package\images\halt-icon.ico"
    
    # Hidden imports for PyInstaller
    HiddenImports  = @(
        "uvicorn",
        "fastapi",
        "sqlalchemy",
        "alembic",
        "psycopg2",
        "redis",
        "httpx",
        "python_multipart",
        "jinja2",
        "python_jose",
        "passlib",
        "prometheus_client",
        "llama_cpp_python",
        "numpy",
        "pydantic",
        "starlette",
        "websockets"
    )
    
    # Data files to include
    DataFiles      = @(
        "backend\app",
        "backend\requirements.txt",
        "core",
        "tools",
        "docs"
    )
}

function Show-Help {
    Write-Host "HALT Windows Executable Builder" -ForegroundColor Green
    Write-Host ""
    Write-Host "Usage: .\Build-Halt.exe.ps1 [ACTION]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Actions:" -ForegroundColor Cyan
    Write-Host "  build     - Build the Windows executable" -ForegroundColor White
    Write-Host "  clean     - Clean build directories" -ForegroundColor White
    Write-Host "  test      - Test the built executable" -ForegroundColor White
    Write-Host "  help      - Show this help message" -ForegroundColor White
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  -IncludeModels    - Include AI models in the executable" -ForegroundColor White
    Write-Host "  -IncludeFrontend  - Include frontend build in the executable" -ForegroundColor White
    Write-Host "  -AppName <name>   - Application name (default: EVEOS)" -ForegroundColor White
    Write-Host "  -Version <ver>    - Version number (default: 1.0.0)" -ForegroundColor White
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Cyan
    Write-Host "  .\Build-Halt.exe.ps1 -Action build" -ForegroundColor White
    Write-Host "  .\Build-Halt.exe.ps1 -Action build -IncludeModels" -ForegroundColor White
    Write-Host "  .\Build-Halt.exe.ps1 -Action test" -ForegroundColor White
}

function Test-Prerequisites {
    Write-Host "Checking prerequisites..." -ForegroundColor Blue
    
    # Check Python installation
    try {
        $pythonVersion = python --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Python found: $pythonVersion" -ForegroundColor Green
        }
        else {
            throw "Python not found"
        }
    }
    catch {
        Write-Host "❌ ERROR: Python is not installed or not in PATH" -ForegroundColor Red
        return $false
    }
    
    # Check pip
    try {
        pip --version | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ pip is available" -ForegroundColor Green
        }
        else {
            throw "pip not found"
        }
    }
    catch {
        Write-Host "❌ ERROR: pip is not available" -ForegroundColor Red
        return $false
    }
    
    # Install PyInstaller if not present
    try {
        pyinstaller --version | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ PyInstaller is available" -ForegroundColor Green
        }
        else {
            throw "PyInstaller not found"
        }
    }
    catch {
        Write-Host "Installing PyInstaller..." -ForegroundColor Yellow
        try {
            pip install pyinstaller
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ PyInstaller installed successfully" -ForegroundColor Green
            }
            else {
                throw "Failed to install PyInstaller"
            }
        }
        catch {
            Write-Host "❌ ERROR: Failed to install PyInstaller: $_" -ForegroundColor Red
            return $false
        }
    }
    
    return $true
}

function Initialize-BuildEnvironment {
    Write-Host "Initializing build environment..." -ForegroundColor Blue
    
    # Create build directories
    $directories = @($BuildDir, $DistDir, "$BuildDir\logs", "$DistDir\data")
    foreach ($dir in $directories) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }
    
    # Install Python dependencies
    Write-Host "Installing Python dependencies..." -ForegroundColor Blue
    $requirementsFile = "$($Config.BackendDir)\requirements.txt"
    
    if (Test-Path $requirementsFile) {
        try {
            pip install -r $requirementsFile
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Python dependencies installed" -ForegroundColor Green
            }
            else {
                throw "Failed to install dependencies"
            }
        }
        catch {
            Write-Host "❌ ERROR: Failed to install Python dependencies: $_" -ForegroundColor Red
            return $false
        }
    }
    else {
        Write-Host "❌ ERROR: requirements.txt not found: $requirementsFile" -ForegroundColor Red
        return $false
    }
    
    return $true
}

function Build-Frontend {
    if (!$IncludeFrontend) {
        Write-Host "Skipping frontend build (not requested)" -ForegroundColor Gray
        return $true
    }
    
    Write-Host "Building frontend..." -ForegroundColor Blue
    
    # Check if we're in the right directory
    if (!(Test-Path "package.json")) {
        Write-Host "❌ ERROR: package.json not found in current directory" -ForegroundColor Red
        return $false
    }
    
    try {
        # Install Node.js dependencies
        npm install
        
        # Build the frontend
        npm run build
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Frontend built successfully" -ForegroundColor Green
            
            # Copy built frontend to dist directory
            if (Test-Path "dist\frontend") {
                Remove-Item -Recurse -Force "dist\frontend" -ErrorAction SilentlyContinue
            }
            New-Item -ItemType Directory -Path "dist\frontend" -Force | Out-Null
            
            # Copy built files
            Copy-Item -Path "frontend\dist\*" -Destination "dist\frontend" -Recurse -Force
            
            return $true
        }
        else {
            throw "Frontend build failed"
        }
    }
    catch {
        Write-Host "❌ ERROR: Failed to build frontend: $_" -ForegroundColor Red
        return $false
    }
}

function Copy-Models {
    if (!$IncludeModels) {
        Write-Host "Skipping model copying (not requested)" -ForegroundColor Gray
        return $true
    }
    
    Write-Host "Copying AI models..." -ForegroundColor Blue
    
    $modelSources = @(
        "tools\llama.cpp\models",
        "data\models"
    )
    
    $modelDest = "dist\models"
    New-Item -ItemType Directory -Path $modelDest -Force | Out-Null
    
    foreach ($source in $modelSources) {
        if (Test-Path $source) {
            Write-Host "Copying models from: $source" -ForegroundColor Blue
            Copy-Item -Path "$source\*" -Destination $modelDest -Recurse -Force
        }
    }
    
    Write-Host "✅ Models copied to: $modelDest" -ForegroundColor Green
    return $true
}

function Create-PyInstallerSpec {
    Write-Host "Creating PyInstaller spec file..." -ForegroundColor Blue
    
    $specContent = @"
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['$($Config.BackendDir)\run_uvicorn.py'],
    pathex=[''],
    binaries=[],
    datas=$($Config.DataFiles | ForEach-Object { "'$_'," } | Out-String),
    hiddenimports=$($Config.HiddenImports | ForEach-Object { "'$_'," } | Out-String),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'scipy',
        'pandas',
        'jupyter',
        'IPython',
        'PyQt5',
        'tkinter',
        'test',
        'tests',
        'testing'
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='$($Config.ExecutableName)',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='$($Config.IconPath)',
    version='version_info.txt'
)
"@
    
    # Write spec file
    $specFile = "halt.spec"
    $specContent | Out-File -FilePath $specFile -Encoding UTF8
    
    # Create version info file
    $versionInfo = @"
# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=($Version.Split('.')[0],$Version.Split('.')[1],$Version.Split('.')[2],0),
    prodvers=($Version.Split('.')[0],$Version.Split('.')[1],$Version.Split('.')[2],0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0,0)
  ),
  kids=[
    StringFileInfo(
      [
      StringTable(
        u'040904B0',
        [StringStruct(u'CompanyName', u'HALT Team'),
        StringStruct(u'FileDescription', u'HALT Medical Platform Backend'),
        StringStruct(u'FileVersion', u'$Version.0'),
        StringStruct(u'InternalName', u'EVEOS'),
        StringStruct(u'LegalCopyright', u'Copyright (C) 2024 HALT Team'),
        StringStruct(u'OriginalFilename', u'$($Config.ExecutableName)'),
        StringStruct(u'ProductName', u'HALT Medical Platform'),
        StringStruct(u'ProductVersion', u'$Version.0')])
      ]),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"@
    
    $versionInfo | Out-File -FilePath "version_info.txt" -Encoding UTF8
    
    Write-Host "✅ PyInstaller spec file created: $specFile" -ForegroundColor Green
    return $true
}

function Build-Executable {
    Write-Host "Building Windows executable..." -ForegroundColor Blue
    
    try {
        # Clean previous builds
        if (Test-Path $BuildDir) {
            Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
        }
        if (Test-Path $DistDir) {
            Remove-Item -Recurse -Force $DistDir -ErrorAction SilentlyContinue
        }
        
        # Run PyInstaller
        pyinstaller halt.spec --clean --noconfirm
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Executable built successfully" -ForegroundColor Green
            
            # Check if executable exists
            $executablePath = "$DistDir\$($Config.ExecutableName)"
            if (Test-Path $executablePath) {
                $fileInfo = Get-Item $executablePath
                Write-Host "Executable: $executablePath" -ForegroundColor Cyan
                Write-Host "Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Cyan
                
                return $true
            }
            else {
                Write-Host "❌ ERROR: Executable not found at expected location" -ForegroundColor Red
                return $false
            }
        }
        else {
            throw "PyInstaller build failed"
        }
    }
    catch {
        Write-Host "❌ ERROR: Failed to build executable: $_" -ForegroundColor Red
        return $false
    }
}

function Test-Executable {
    Write-Host "Testing built executable..." -ForegroundColor Blue
    
    $executablePath = "$DistDir\$($Config.ExecutableName)"
    
    if (!(Test-Path $executablePath)) {
        Write-Host "❌ ERROR: Executable not found: $executablePath" -ForegroundColor Red
        return $false
    }
    
    try {
        # Test executable startup
        Write-Host "Testing executable startup..." -ForegroundColor Blue
        $process = Start-Process -FilePath $executablePath -ArgumentList "--help" -Wait -PassThru -WindowStyle Hidden
        
        if ($process.ExitCode -eq 0) {
            Write-Host "✅ Executable runs successfully" -ForegroundColor Green
        }
        else {
            Write-Host "⚠️  WARNING: Executable returned exit code: $($process.ExitCode)" -ForegroundColor Yellow
        }
        
        return $true
    }
    catch {
        Write-Host "❌ ERROR: Failed to test executable: $_" -ForegroundColor Red
        return $false
    }
}

function Clean-Build {
    Write-Host "Cleaning build directories..." -ForegroundColor Blue
    
    $cleanupItems = @($BuildDir, $DistDir, "halt.spec", "version_info.txt", "__pycache__")
    
    foreach ($item in $cleanupItems) {
        if (Test-Path $item) {
            if ($item -eq "__pycache__") {
                Remove-Item -Recurse -Force $item -ErrorAction SilentlyContinue
            }
            else {
                Remove-Item -Recurse -Force $item -ErrorAction SilentlyContinue
            }
            Write-Host "✅ Cleaned: $item" -ForegroundColor Green
        }
    }
    
    return $true
}

function Create-PackageStructure {
    Write-Host "Creating final package structure..." -ForegroundColor Blue
    
    $packageDir = "$DistDir\package"
    New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
    
    # Copy executable
    Copy-Item -Path "$DistDir\$($Config.ExecutableName)" -Destination $packageDir
    
    # Create startup script
    $startupScript = @"
@echo off
echo Starting HALT Medical Platform...
"$($Config.ExecutableName)" --host 0.0.0.0 --port 7778
pause
"@
    
    $startupScript | Out-File -FilePath "$packageDir\start-halt.bat" -Encoding ASCII
    
    # Create README
    $readme = @"
# HALT Medical Platform - Standalone Executable

## Quick Start

1. Double-click `start-halt.bat` to start the service
2. Open your browser and go to http://localhost:7778
3. Use Ctrl+C to stop the service

## Manual Start

```cmd
$($Config.ExecutableName) --host 0.0.0.0 --port 7778
```

## API Documentation

Once started, visit http://localhost:7778/docs for API documentation.

## Requirements

- Windows 10/11 (64-bit)
- No additional software required

## Logs

Logs are written to the console window and can be redirected if needed.

For more information, visit: https://docs.halt.com
"@
    
    $readme | Out-File -FilePath "$packageDir\README.txt" -Encoding UTF8
    
    Write-Host "✅ Package structure created: $packageDir" -ForegroundColor Green
    return $true
}

# Main execution
if ($Help -or $Action -eq "help") {
    Show-Help
    exit 0
}

Write-Host "HALT Windows Executable Builder" -ForegroundColor Green
Write-Host "Action: $Action" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
if (!(Test-Prerequisites)) {
    exit 1
}

# Execute action based on parameter
switch ($Action) {
    "build" {
        if (!(Initialize-BuildEnvironment)) { exit 1 }
        if (!(Build-Frontend)) { exit 1 }
        if (!(Copy-Models)) { exit 1 }
        if (!(Create-PyInstallerSpec)) { exit 1 }
        if (!(Build-Executable)) { exit 1 }
        if (!(Test-Executable)) { exit 1 }
        if (!(Create-PackageStructure)) { exit 1 }
        
        # Sign the output if requested
        if ($SignOutput) {
            Write-Host "" 
            Write-Host "Signing build output..." -ForegroundColor Blue
            $signScript = Join-Path $PSScriptRoot "Sign-Halt.ps1"
            if (Test-Path $signScript) {
                $signArgs = @("-Action", "sign", "-SignAll")
                if ($CertificatePath) {
                    $signArgs += @("-CertificatePath", $CertificatePath)
                }
                & $signScript @signArgs
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "⚠️  Code signing failed, but build is complete" -ForegroundColor Yellow
                }
                else {
                    Write-Host "✅ Build output signed successfully" -ForegroundColor Green
                }
            }
            else {
                Write-Host "⚠️  Sign-Halt.ps1 not found, skipping signing" -ForegroundColor Yellow
            }
        }
        
        Write-Host ""
        Write-Host "🎉 Build completed successfully!" -ForegroundColor Green
        Write-Host "Package location: $DistDir\package" -ForegroundColor Cyan
        
        if (!$SignOutput) {
            Write-Host ""
            Write-Host "💡 Tip: Add -SignOutput to sign the build for Windows Smart App Control trust" -ForegroundColor Cyan
        }
    }
    "clean" {
        Clean-Build
    }
    "test" {
        Test-Executable
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Show-Help
        exit 1
    }
}