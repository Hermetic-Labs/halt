# HALT Windows Preflight Check
Write-Host "Starting HALT Windows Preflight Check..." -ForegroundColor Cyan

# 1. Check Python
Write-Host "`n[1/5] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python (\d+\.\d+)") {
        $version = [version]$matches[1]
        if ($version -ge [version]"3.10") {
            Write-Host "✅ Python $version is installed." -ForegroundColor Green
        } else {
            Write-Host "❌ Python version $version is too old. Requirement: 3.10+" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ Python not found or unable to determine version." -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Python not found." -ForegroundColor Red
}

# 2. Check Node.js
Write-Host "`n[2/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($nodeVersion -match "v(\d+)") {
        $major = [int]$matches[1]
        if ($major -ge 18) {
            Write-Host "✅ Node.js $nodeVersion is installed." -ForegroundColor Green
        } else {
            Write-Host "❌ Node.js version $nodeVersion is too old. Requirement: v18+" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ Node.js not found." -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Node.js not found." -ForegroundColor Red
}

# 3. Check C++ Build Tools
Write-Host "`n[3/5] Checking C++ Build Tools (needed for llama-cpp-python)..." -ForegroundColor Yellow
# Simple check for cl.exe in path is loose, but checking common registry keys or typical paths is better. 
# For now, we'll try to find 'cl.exe' or warn.
if (Get-Command "cl.exe" -ErrorAction SilentlyContinue) {
    Write-Host "✅ C++ Compiler (cl.exe) found in PATH." -ForegroundColor Green
} else {
    Write-Host "⚠️  C++ Compiler not found in PATH." -ForegroundColor Magenta
    Write-Host "   You may need 'Visual Studio Build Tools' with 'Desktop development with C++' workload"
    Write-Host "   installed for backend dependencies to compile successfully."
}

# 4. Check Docker
Write-Host "`n[4/5] Checking Docker (Optional)..." -ForegroundColor Yellow
if (Get-Command "docker" -ErrorAction SilentlyContinue) {
    try {
        $dockerInfo = docker info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Docker is installed and running." -ForegroundColor Green
        } else {
             Write-Host "⚠️  Docker is installed but might not be running." -ForegroundColor Magenta
        }
    } catch {
        Write-Host "⚠️  Docker check failed." -ForegroundColor Magenta
    }
} else {
    Write-Host "ℹ️  Docker not found. Skipping (Optional)." -ForegroundColor Gray
}

# 5. Check Environment File
Write-Host "`n[5/5] Checking Configuration..." -ForegroundColor Yellow
$envPath = Join-Path $PWD "backend\.env"
if (Test-Path $envPath) {
    Write-Host "✅ Backend .env file exists." -ForegroundColor Green
} else {
    Write-Host "⚠️  Backend .env file missing at $envPath." -ForegroundColor Magenta
    Write-Host "   Copy .env.example to .env and configure it."
}

Write-Host "`nPreflight check complete." -ForegroundColor Cyan
