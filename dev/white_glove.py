"""
HALT — White Glove Lint Pass
==============================
The pristine pass. Maximum strictness. Every voicebox collected.

Runs every possible linter across the entire codebase:
  🐍 Python    → Ruff (ALL rules, lint + format check)
  📜 JavaScript → ESLint (strict, via npx)
  🌐 HTML       → html-validate (via npx)
  🐚 Shell      → ShellCheck (severity=style)
  📝 Markdown   → markdownlint-cli2 (via npx)
  📦 JSON/YAML  → Python built-in validation
  ⚡ PowerShell → Syntax parse check
  🦀 Rust       → cargo clippy

Usage:
  python dev/white_glove.py              # Full sweep
  python dev/white_glove.py --python     # Python only
  python dev/white_glove.py --js         # JavaScript only
  python dev/white_glove.py --html       # HTML only
  python dev/white_glove.py --shell      # Shell only
  python dev/white_glove.py --markdown   # Markdown only
  python dev/white_glove.py --data       # JSON/YAML only
  python dev/white_glove.py --rust       # Rust only (cargo clippy)
  python dev/white_glove.py --fix        # Auto-fix where possible (Ruff)

Prime author only. Not for distribution.
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path

# ── Windows console encoding fix ─────────────────────────────────────────────
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent

# ── Excluded directories (third-party, build artifacts, caches) ──────────────
EXCLUDED_DIRS = {
    "runtime",
    "models",
    "HALT-v1.0.01",
    "node_modules",
    "__pycache__",
    ".git",
    ".github",
    ".vscode",
    ".idea",
    ".gemini",
    "builds",
    "dist",
    "__fresh_test__",
    "site",
    # Triage generated medical data — not source code
    "medications",
    "procedures",
    "conditions",
    "supplies",
    "special_populations",
    "symptoms",
    "assessments",
    "interventions",
    "equipment",
    "protocols",
    "flowcharts",
    "documentation_templates",
    "anatomy_reference",
    "field_reference",
}


# ═════════════════════════════════════════════════════════════════════════════
#  UTILITIES
# ═════════════════════════════════════════════════════════════════════════════


def banner():
    print()
    print("  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — White Glove Lint Pass        ║")
    print("  ║   The Pristine Pass™                  ║")
    print("  ╚═══════════════════════════════════════╝")
    print()


def find_files(extensions, extra_excludes=None):
    """Walk repo and collect first-party files by extension."""
    excludes = EXCLUDED_DIRS | (extra_excludes or set())
    found = []
    for root, dirs, files in os.walk(REPO_ROOT):
        # Prune excluded directories in-place
        dirs[:] = [d for d in dirs if d not in excludes]
        for f in files:
            if any(f.endswith(ext) for ext in extensions):
                found.append(Path(root) / f)
    return sorted(found)


def run_tool(cmd, label="tool", capture=True):
    """Run a subprocess, return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            cwd=str(REPO_ROOT),
            shell=True,
            timeout=120,
        )
        return result.returncode, result.stdout or "", result.stderr or ""
    except FileNotFoundError:
        return -1, "", f"{label} not found on PATH"
    except subprocess.TimeoutExpired:
        return -1, "", f"{label} timed out (120s)"


def check_tool(name, check_cmd):
    """Check if a tool is available. Returns True/False."""
    code, _, _ = run_tool(check_cmd, label=name)
    return code == 0 or code == 1  # some tools return 1 for --version oddities


def section_header(emoji, title, file_count):
    print()
    print(f"  {'─' * 60}")
    print(f"  {emoji}  {title}  ({file_count} file{'s' if file_count != 1 else ''})")
    print(f"  {'─' * 60}")


def rel_path(filepath):
    """Safely get a path relative to repo root (Windows-safe)."""
    try:
        return os.path.relpath(str(filepath), str(REPO_ROOT))
    except ValueError:
        return str(filepath)


def issue_line(filepath, message):
    """Print a single issue, path relative to repo root."""
    rel = rel_path(filepath)
    print(f"    ⚠  {rel}: {message}")


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 1: PYTHON — Ruff (ALL rules)
# ═════════════════════════════════════════════════════════════════════════════


def lint_python(fix=False, strict=False):
    """Run Ruff lint. Default = practical rules only. --strict = ALL rules."""
    files = find_files([".py"])
    mode_label = "ALL rules" if strict else "practical"
    section_header("🐍", f"PYTHON — Ruff ({mode_label})", len(files))

    if not files:
        print("    No Python files found.")
        return 0

    # Check ruff is available
    code, out, _ = run_tool(["ruff", "--version"])
    if code != 0 and code != -1:
        code, out, _ = run_tool(["python", "-m", "ruff", "--version"])
    if code != 0 and code not in (0, 1):
        print("    ✗ Ruff not found. Install: pip install ruff")
        return -1

    ruff_version = out.strip()
    print(f"    Using: {ruff_version}")
    if not strict:
        print("    Mode: practical (bugs, unused code, complexity)")
        print("    Tip:  use --strict for the full style sweep")

    # Build file list (relative paths)
    file_args = [rel_path(f) for f in files]

    # ── Build rule selection ──────────────────────────────────────────────
    if strict:
        # STRICT: every rule, minimal ignores (only true conflicts)
        select = "ALL"
        ignore_rules = [
            "D100",
            "D101",
            "D102",
            "D103",
            "D104",
            "D105",
            "D107",  # Missing docstrings
            "D203",  # Conflicts with D211
            "D213",  # Conflicts with D212
            "INP001",  # Implicit namespace package
            "T201",  # print() — intentional in CLI scripts
            "ANN",  # Type annotations — too strict for fast-moving codebase
            "ERA001",  # Commented-out code
            "FIX002",  # TODO comments
            "TD",  # TODO format
            "COM812",  # Trailing comma — conflicts with formatter
            "ISC001",  # String concat — conflicts with formatter
        ]
    else:
        # DEFAULT: only rules that catch real problems
        # F   = Pyflakes (unused imports, undefined names, redefined vars)
        # E   = pycodestyle errors (syntax-level, not style opinion)
        # W   = pycodestyle warnings (whitespace in blank lines, etc.)
        # C90 = McCabe complexity (function too complex)
        # N   = pep8-naming (mixedCase, CONSTANT naming)
        # UP  = pyupgrade (deprecated syntax for target Python version)
        # B   = flake8-bugbear (likely bugs, opinionated but useful)
        # A   = flake8-builtins (shadowing builtins like id/type/list)
        # RUF = Ruff-specific (ambiguous chars, asyncio bugs)
        # PERF = Perflint (performance anti-patterns)
        # ASYNC = async linting (blocking calls in async functions)
        # PLW = Pylint warnings (global statement, unreachable code)
        # PLE = Pylint errors (actual errors, not opinions)
        # PLR = Pylint refactor (too complex, too many branches)
        # RET = flake8-return (inconsistent returns)
        # SIM = flake8-simplify (unnecessarily complex code)
        # TRY = tryceratops (exception handling anti-patterns)
        # FBT = boolean trap (boolean positional args)
        # ARG = unused arguments
        # PTH = pathlib (only in strict — os.path is fine)
        select = ",".join(
            [
                "F",  # Pyflakes — unused imports, undefined names (THE essentials)
                "E",  # pycodestyle errors — real formatting problems
                "W",  # pycodestyle warnings — whitespace in blank lines
                "C90",  # McCabe complexity — function too complex
                "B",  # Bugbear — likely bugs and design problems
                "RUF",  # Ruff-specific — ambiguous unicode, asyncio task bugs
                "PERF",  # Performance — unnecessary list copies, etc.
                "ASYNC",  # Async — blocking calls in async functions
                "PLE",  # Pylint errors — actual code errors
                "PLW",  # Pylint warnings — global, unreachable code
                "PLR",  # Pylint refactor — too complex, too many branches
                "SIM",  # Simplify — unnecessarily complex patterns
                "TRY",  # Exception handling — bare except, wrong logging
                "UP",  # Pyupgrade — deprecated syntax
            ]
        )
        ignore_rules = [
            "E501",  # Line too long — formatter handles this
            "TRY003",  # Long exception messages — fine for us
            "PLR2004",  # Magic values — too noisy, we know our HTTP codes
            "PLR0913",  # Too many function arguments — FastAPI routes need them
            "UP007",  # X | Y union syntax — Optional[X] is still fine
        ]

    # ── Lint check ────────────────────────────────────────────────────────
    cmd = [
        "ruff",
        "check",
        "--select",
        select,
        "--target-version",
        "py311",
        "--line-length",
        "120",
        "--ignore",
        ",".join(ignore_rules),
        "--output-format",
        "text",
    ]

    if fix:
        cmd.append("--fix")
        print("    [FIX MODE] Auto-fixing where possible...")

    cmd.extend(file_args)
    code, out, err = run_tool(cmd, label="ruff check")

    issues = 0
    if out.strip():
        for line in out.strip().splitlines():
            print(f"    {line}")
            if line and not line.startswith("Found") and not line.startswith("All checks"):
                issues += 1

    # ── Format check ──────────────────────────────────────────────────────
    print()
    print("    ── Format check (ruff format --check) ──")

    fmt_cmd = [
        "ruff",
        "format",
        "--check",
        "--target-version",
        "py311",
        "--line-length",
        "120",
    ] + file_args

    fmt_code, fmt_out, fmt_err = run_tool(fmt_cmd, label="ruff format")
    fmt_issues = 0

    if fmt_code != 0:
        combined = (fmt_out + fmt_err).strip()
        for line in combined.splitlines():
            if line.strip() and "would reformat" in line.lower():
                fmt_issues += 1
                print(f"    ⚠  {line.strip()}")
            elif line.strip() and "file" in line.lower():
                print(f"    {line.strip()}")

    if fmt_issues == 0 and issues == 0:
        print("    ✓  All Python files pristine")
    else:
        if fmt_issues > 0:
            print(f"    Fix formatting: ruff format {' '.join(file_args[:3])}...")

    return issues + fmt_issues


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 2: JAVASCRIPT — ESLint (strict)
# ═════════════════════════════════════════════════════════════════════════════


def lint_javascript():
    """Run ESLint with strict config via npx. No permanent install."""
    files = find_files([".js"])
    section_header("📜", "JAVASCRIPT — ESLint (strict)", len(files))

    if not files:
        print("    No JavaScript files found.")
        return 0

    # Write a temporary flat config for ESLint
    eslint_config = REPO_ROOT / "eslint.config.mjs"
    config_content = """\
import js from "@eslint/js";
export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                require: "readonly",
                module: "readonly",
                exports: "readonly",
                process: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                Buffer: "readonly",
                URL: "readonly",
                global: "readonly",
            },
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-console": "off",
            "eqeqeq": ["error", "always"],
            "no-var": "error",
            "prefer-const": "warn",
            "no-throw-literal": "error",
            "no-shadow": "warn",
            "no-redeclare": "error",
            "no-duplicate-imports": "error",
            "consistent-return": "warn",
            "curly": ["warn", "multi-line"],
            "default-case": "warn",
            "dot-notation": "warn",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-return-await": "warn",
            "no-self-compare": "error",
            "no-useless-concat": "warn",
            "no-useless-return": "warn",
            "prefer-template": "warn",
            "radix": "error",
            "yoda": "warn",
            "no-lonely-if": "warn",
            "no-unneeded-ternary": "warn",
            "prefer-arrow-callback": "warn",
            "no-empty-function": "warn",
            "no-implicit-coercion": "warn",
            "no-multi-assign": "warn",
            "no-nested-ternary": "warn",
            "no-new-wrappers": "error",
            "no-proto": "error",
            "no-sequences": "error",
            "no-void": "error",
            "prefer-rest-params": "error",
            "prefer-spread": "error",
            "symbol-description": "warn",
        },
    },
];
"""
    config_existed = eslint_config.exists()
    if not config_existed:
        eslint_config.write_text(config_content, encoding="utf-8")

    file_args = [rel_path(f) for f in files]

    try:
        cmd = ["npx", "-y", "eslint@latest"] + file_args
        code, out, err = run_tool(cmd, label="eslint")

        issues = 0
        combined = (out + err).strip()
        if combined:
            for line in combined.splitlines():
                # Skip npx noise
                if "npm warn" in line.lower() or "need to install" in line.lower():
                    continue
                print(f"    {line}")
                if "warning" in line.lower() or "error" in line.lower():
                    # Count lines that contain actual issue indicators
                    if ":" in line and ("warning" in line or "error" in line):
                        issues += 1

        if issues == 0 and code == 0:
            print("    ✓  All JavaScript files pristine")

        return issues
    finally:
        # Clean up temp config if we created it
        if not config_existed and eslint_config.exists():
            eslint_config.unlink()


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 3: HTML — html-validate (strict)
# ═════════════════════════════════════════════════════════════════════════════


def lint_html():
    """Run html-validate via npx for strict HTML checking."""
    files = find_files([".html"])
    section_header("🌐", "HTML — html-validate (strict)", len(files))

    if not files:
        print("    No HTML files found.")
        return 0

    issues = 0

    for fpath in files:
        cmd = ["npx", "-y", "html-validate@latest", str(fpath)]
        code, out, err = run_tool(cmd, label="html-validate")

        combined = (out + err).strip()
        if code != 0 and combined:
            for line in combined.splitlines():
                if "npm warn" in line.lower() or "need to install" in line.lower():
                    continue
                if "error" in line.lower() or "warning" in line.lower():
                    issues += 1
                print(f"    {line}")
        elif code == 0:
            # Check for warnings in output even on success
            if combined:
                for line in combined.splitlines():
                    if "npm warn" in line.lower() or "need to install" in line.lower():
                        continue
                    if line.strip():
                        print(f"    {line}")

    if issues == 0:
        print("    ✓  All HTML files pristine")

    return issues


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 4: SHELL — ShellCheck (severity=style)
# ═════════════════════════════════════════════════════════════════════════════


def lint_shell():
    """Run ShellCheck at maximum strictness (style level)."""
    files = find_files([".sh", ".command", ".bash"])
    section_header("🐚", "SHELL — ShellCheck (severity=style)", len(files))

    if not files:
        print("    No shell scripts found.")
        return 0

    # Check if shellcheck is available
    code, _, _ = run_tool(["shellcheck", "--version"])
    if code != 0:
        print("    ✗ ShellCheck not found.")
        print("      Install: scoop install shellcheck  (or choco install shellcheck)")
        print("      Falling back to basic syntax check...")
        return _basic_shell_check(files)

    issues = 0
    for fpath in files:
        rel = rel_path(fpath)
        cmd = [
            "shellcheck",
            "--severity=style",
            "--format=gcc",
            "--shell=bash",
            str(fpath),
        ]
        code, out, err = run_tool(cmd, label="shellcheck")

        if code != 0:
            combined = (out + err).strip()
            if combined:
                for line in combined.splitlines():
                    issues += 1
                    # Make paths relative
                    display = line.replace(str(fpath), str(rel))
                    print(f"    ⚠  {display}")

    if issues == 0:
        print("    ✓  All shell scripts pristine")

    return issues


def _basic_shell_check(files):
    """Fallback: check for common shell issues without ShellCheck."""
    issues = 0
    for fpath in files:
        rel = rel_path(fpath)
        try:
            content = fpath.read_text(encoding="utf-8", errors="replace")
            lines = content.splitlines()

            # Check for shebang
            if lines and not lines[0].startswith("#!"):
                issue_line(rel, "Missing shebang (#!/bin/bash or #!/usr/bin/env bash)")
                issues += 1

            # Check for common issues
            for i, line in enumerate(lines, 1):
                stripped = line.strip()
                if stripped and stripped.endswith(" "):
                    issue_line(rel, f"Line {i}: trailing whitespace")
                    issues += 1
                if "\t" in line and "  " in line:
                    issue_line(rel, f"Line {i}: mixed tabs and spaces")
                    issues += 1

        except Exception as e:
            issue_line(rel, f"Could not read: {e}")
            issues += 1

    return issues


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 5: POWERSHELL — Syntax Parse Check
# ═════════════════════════════════════════════════════════════════════════════


def lint_powershell():
    """Parse-check PowerShell scripts and run PSScriptAnalyzer if available."""
    files = find_files([".ps1"])
    section_header("⚡", "POWERSHELL — Parse + Analyze", len(files))

    if not files:
        print("    No PowerShell scripts found.")
        return 0

    issues = 0

    # Try PSScriptAnalyzer first (the real linter)
    check_cmd = [
        "powershell",
        "-NoProfile",
        "-Command",
        "if (Get-Module -ListAvailable -Name PSScriptAnalyzer) { 'yes' } else { 'no' }",
    ]
    code, out, _ = run_tool(check_cmd, label="PSScriptAnalyzer check")
    has_analyzer = "yes" in out.lower() if code == 0 else False

    if has_analyzer:
        print("    Using: PSScriptAnalyzer")
        for fpath in files:
            rel = rel_path(fpath)
            cmd = [
                "powershell",
                "-NoProfile",
                "-Command",
                f"Invoke-ScriptAnalyzer -Path '{fpath}' -Severity @('Error','Warning','Information') | "
                f"ForEach-Object {{ '{0}:{{1}}:{{2}}: [{{3}}] {{4}}' -f $_.ScriptName, $_.Line, $_.Column, $_.Severity, $_.Message }}",
            ]
            code, out, err = run_tool(cmd, label="PSScriptAnalyzer")
            combined = (out + err).strip()
            if combined:
                for line in combined.splitlines():
                    if line.strip():
                        issues += 1
                        print(f"    ⚠  {line.strip()}")
    else:
        print("    PSScriptAnalyzer not found — falling back to syntax parse check")
        print("    Install for full analysis: Install-Module -Name PSScriptAnalyzer -Force")
        print()

        for fpath in files:
            rel = rel_path(fpath)
            cmd = [
                "powershell",
                "-NoProfile",
                "-Command",
                f"$null = [System.Management.Automation.Language.Parser]::ParseFile('{fpath}', [ref]$null, [ref]$errors); "
                f"$errors | ForEach-Object {{ $_.Message }}",
            ]
            code, out, err = run_tool(cmd, label="PS syntax check")
            combined = (out + err).strip()
            if combined and "parse" not in combined.lower():
                # Filter out empty/noise
                for line in combined.splitlines():
                    if line.strip():
                        issues += 1
                        issue_line(rel, line.strip())

    if issues == 0:
        print("    ✓  All PowerShell scripts pristine")

    return issues


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 6: MARKDOWN — markdownlint-cli2 (via npx)
# ═════════════════════════════════════════════════════════════════════════════


def lint_markdown():
    """Run markdownlint-cli2 via npx for strict Markdown checking."""
    files = find_files([".md"])
    section_header("📝", "MARKDOWN — markdownlint-cli2 (strict)", len(files))

    if not files:
        print("    No Markdown files found.")
        return 0

# ═════════════════════════════════════════════════════════════════════════════
#  PASS 8: RUST — Cargo Clippy + Format Check
# ═════════════════════════════════════════════════════════════════════════════


def lint_rust():
    """Run `cargo clippy` and `cargo fmt -- --check` for Rust files."""
    files = find_files([".rs"])
    section_header("🦀", "RUST — Cargo Clippy & Format", len(files))

    if not files:
        print("    No Rust files found.")
        return 0

    # Ensure cargo is available
    code, _, _ = run_tool(["cargo", "--version"])
    if code != 0:
        print("    ✗ Cargo not found.")
        return -1

    # In Tauri projects, Cargo.toml is usually in src-tauri
    cargo_toml = REPO_ROOT / "viewer" / "src-tauri" / "Cargo.toml"
    if not cargo_toml.exists():
        print("    ✗ Cargo.toml not found in viewer/src-tauri")
        return -1

    cwd = str(cargo_toml.parent)
    issues = 0

    # Clippy execution
    cmd_clippy = ["cargo", "clippy", f"--manifest-path={cargo_toml}", "--all-targets", "--all-features", "--", "-D", "warnings"]
    code, out, err = run_tool(cmd_clippy, label="cargo clippy")
    
    combined = (out + err).strip()
    if code != 0 and combined:
        for line in combined.splitlines():
            if "warning:" in line.lower() or "error:" in line.lower():
                issues += 1
                print(f"    ⚠  {line.strip()}")
            elif "could not compile" in line.lower():
                print(f"    {line.strip()}")
                issues += 1

    # Fmt check execution
    print()
    print("    ── Format check (cargo fmt -- --check) ──")
    cmd_fmt = ["cargo", "fmt", f"--manifest-path={cargo_toml}", "--", "--check"]
    fmt_code, fmt_out, fmt_err = run_tool(cmd_fmt, label="cargo fmt")
    
    fmt_issues = 0
    if fmt_code != 0:
        combined = (fmt_out + fmt_err).strip()
        for line in combined.splitlines():
            if "diff errors" in line or "Diff in" in line:
                fmt_issues += 1
                print(f"    ⚠  {line.strip()}")
            
    if issues == 0 and fmt_issues == 0:
        print("    ✓  All Rust files pristine")
    else:
        if fmt_issues > 0:
            print(f"    Fix formatting: cd viewer/src-tauri && cargo fmt")

    return issues + fmt_issues

    # Write temp config (inline — no pollution)
    config_path = REPO_ROOT / ".markdownlint-cli2.jsonc"
    config_existed = config_path.exists()

    config_content = """{
    "config": {
        "default": true,
        "MD013": { "line_length": 300 },
        "MD033": { "allowed_elements": ["br", "img", "a", "details", "summary", "sub", "sup", "kbd", "picture", "source", "video"] },
        "MD041": true
    }
}
"""
    if not config_existed:
        config_path.write_text(config_content, encoding="utf-8")

    file_args = [rel_path(f) for f in files]

    try:
        cmd = ["npx", "-y", "markdownlint-cli2@latest"] + file_args
        code, out, err = run_tool(cmd, label="markdownlint-cli2")

        issues = 0
        combined = (out + err).strip()
        if combined:
            for line in combined.splitlines():
                if "npm warn" in line.lower() or "need to install" in line.lower():
                    continue
                if line.strip():
                    print(f"    {line}")
                    # Count actual issues (lines with rule IDs like MD001)
                    if "MD0" in line or "MD1" in line:
                        issues += 1

        if issues == 0 and code == 0:
            print("    ✓  All Markdown files pristine")

        return issues
    finally:
        if not config_existed and config_path.exists():
            config_path.unlink()


# ═════════════════════════════════════════════════════════════════════════════
#  PASS 7: JSON / YAML — Syntax Validation
# ═════════════════════════════════════════════════════════════════════════════


def lint_data():
    """Validate JSON and YAML files for syntax correctness."""
    json_files = find_files([".json"])
    yaml_files = find_files([".yml", ".yaml"])
    total = len(json_files) + len(yaml_files)
    section_header("📦", "JSON / YAML — Syntax Validation", total)

    if total == 0:
        print("    No JSON/YAML files found.")
        return 0

    issues = 0

    # JSON
    for fpath in json_files:
        rel = rel_path(fpath)
        try:
            content = fpath.read_text(encoding="utf-8")
            json.loads(content)
        except json.JSONDecodeError as e:
            issues += 1
            issue_line(rel, f"Invalid JSON: {e}")
        except Exception as e:
            issues += 1
            issue_line(rel, f"Could not read: {e}")

    # YAML
    for fpath in yaml_files:
        rel = rel_path(fpath)
        try:
            import yaml

            content = fpath.read_text(encoding="utf-8")
            yaml.safe_load(content)
        except ImportError:
            # Try basic validation without pyyaml
            try:
                content = fpath.read_text(encoding="utf-8")
                if not content.strip():
                    issues += 1
                    issue_line(rel, "Empty YAML file")
            except Exception as e:
                issues += 1
                issue_line(rel, f"Could not read: {e}")
        except Exception as e:
            issues += 1
            issue_line(rel, f"Invalid YAML: {e}")

    if issues == 0:
        print("    ✓  All data files pristine")

    return issues


# ═════════════════════════════════════════════════════════════════════════════
#  BONUS: TRAILING WHITESPACE + LINE ENDINGS + BOM
# ═════════════════════════════════════════════════════════════════════════════


def lint_hygiene():
    """Check for trailing whitespace, mixed line endings, BOM, tabs in Python."""
    all_files = find_files([".py", ".js", ".html", ".css", ".md", ".json", ".yml", ".yaml"])
    section_header("🧹", "HYGIENE — Whitespace, BOM, Line Endings", len(all_files))

    if not all_files:
        print("    No files to check.")
        return 0

    issues = 0
    MAX_ISSUES_PER_FILE = 5  # Don't flood with 500 trailing-ws lines

    for fpath in all_files:
        rel = rel_path(fpath)
        file_issues = 0
        try:
            raw = fpath.read_bytes()

            # BOM check
            if raw.startswith(b"\xef\xbb\xbf"):
                issue_line(rel, "Contains UTF-8 BOM (byte order mark)")
                issues += 1
                file_issues += 1

            content = raw.decode("utf-8", errors="replace")
            lines = content.splitlines(keepends=True)

            has_crlf = False
            has_lf = False
            trailing_ws_lines = []

            for i, line in enumerate(lines, 1):
                # Line ending check
                if line.endswith("\r\n"):
                    has_crlf = True
                elif line.endswith("\n"):
                    has_lf = True

                # Trailing whitespace (not just newline)
                stripped = line.rstrip("\r\n")
                if stripped != stripped.rstrip():
                    trailing_ws_lines.append(i)

            # Mixed line endings
            if has_crlf and has_lf:
                issue_line(rel, "Mixed line endings (CRLF + LF)")
                issues += 1
                file_issues += 1

            # Trailing whitespace
            if trailing_ws_lines:
                count = len(trailing_ws_lines)
                preview = trailing_ws_lines[:MAX_ISSUES_PER_FILE]
                lines_str = ", ".join(str(n) for n in preview)
                suffix = f" (+{count - MAX_ISSUES_PER_FILE} more)" if count > MAX_ISSUES_PER_FILE else ""
                issue_line(rel, f"Trailing whitespace on {count} line(s): {lines_str}{suffix}")
                issues += 1
                file_issues += 1

            # No final newline
            if content and not content.endswith("\n"):
                issue_line(rel, "Missing final newline")
                issues += 1
                file_issues += 1

        except Exception as e:
            issue_line(rel, f"Could not read: {e}")
            issues += 1

    if issues == 0:
        print("    ✓  All files clean")

    return issues


# ═════════════════════════════════════════════════════════════════════════════
#  SCOREBOARD
# ═════════════════════════════════════════════════════════════════════════════


def scoreboard(results):
    """Print the final scoreboard."""
    total = sum(v for v in results.values() if v > 0)
    skipped = sum(1 for v in results.values() if v == -1)

    print()
    print()
    print("  ╔═══════════════════════════════════════════════════╗")
    print("  ║           WHITE GLOVE SCOREBOARD                 ║")
    print("  ╠═══════════════════════════════════════════════════╣")

    for name, count in results.items():
        if count == -1:
            status = "SKIP  (tool not found)"
            icon = "⬜"
        elif count == 0:
            status = "PRISTINE"
            icon = "✅"
        else:
            status = f"{count} issue{'s' if count != 1 else ''}"
            icon = "🔴"
        # Pad for alignment
        label = f"{icon}  {name}".ljust(35)
        print(f"  ║  {label} {status.ljust(18)}║")

    print("  ╠═══════════════════════════════════════════════════╣")

    if total == 0 and skipped == 0:
        print("  ║  🏆  PRISTINE — Zero issues. White glove clean.  ║")
    elif total == 0 and skipped > 0:
        print("  ║  ✅  Clean (with skipped tools — install them)    ║")
    else:
        summary = f"  ║  📋  {total} total issue{'s' if total != 1 else ''} found"
        print(f"{summary.ljust(53)}║")

    print("  ╚═══════════════════════════════════════════════════╝")
    print()

    return total


# ═════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═════════════════════════════════════════════════════════════════════════════


def benchmark_models():
    """Automate ML prompts to test both Rust and Python backends."""
    section_header("🤖", "MACHINE LEARNING — AI Prompts Speed Test", 2)
    issues = 0

    print("  [1] Starting Rust Native ML Benchmark (cargo run --features native_ml)...")
    rust_cmd = ["cargo", "run", "-q", "--manifest-path=" + str(REPO_ROOT / "viewer" / "src-tauri" / "Cargo.toml"), "--features", "native_ml", "--", "--benchmark-llm"]
    code, out, err = run_tool(rust_cmd, label="rust ml", capture=True)
    if code == 0:
        for line in out.splitlines():
            if "tokens/sec" in line or "loaded in" in line.lower() or "Response:" in line:
                print(f"      {line.strip()}")
            elif "NOT enabled" in line:
                print(f"      {line.strip()}")
    else:
        print("      ⚠ Rust benchmark failed or native_ml not supported on this device.")
        if "could not compile" in err or "link" in err.lower() or "error:" in err.lower():
             print("      (Missing C++ Build Tools or unsupported compiler)")
        
    print()
    print("  [2] Starting Python FastAPI Fallback Benchmark...")
    api_dir = str(REPO_ROOT / "api")
    import socket, urllib.request
    
    port = 7799
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--port", str(port)], cwd=api_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ready = False
        for _ in range(40):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    ready = True
                    break
            except:
                time.sleep(0.5)
        
        if not ready:
            print("      ⚠ Python server failed to start.")
            issues += 1
        else:
            print("      Python API ready. Sending prompt...")
            req_data = json.dumps({"messages": [{"role": "user", "content": "What are the 5 phases of triage?"}], "max_tokens": 128, "temperature": 0.1}).encode("utf-8")
            req = urllib.request.Request(f"http://127.0.0.1:{port}/inference/stream", data=req_data, headers={"Content-Type": "application/json"})
            start_t = time.time()
            ttft = None
            tokens = 0
            full = ""
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    for raw_line in resp:
                        line = raw_line.decode("utf-8").strip()
                        if line.startswith("data: "):
                            data_str = line[6:]
                            try:
                                data = json.loads(data_str)
                                if "token" in data and data["token"]:
                                    if ttft is None:
                                        ttft = time.time() - start_t
                                    tokens += 1
                                    full += data["token"]
                            except:
                                pass
                end_t = time.time()
                dur = end_t - start_t
                tps = tokens / dur if dur > 0 else 0
                if ttft:
                    print(f"      Model TTFT (Time to first token): {ttft:.2f}s")
                print(f"      Generated {tokens} tokens in {dur:.2f}s ({tps:.2f} tokens/sec)")
                print(f"      Response: {full.strip()}")
            except Exception as e:
                print(f"      ⚠ Python benchmark request failed: {e}")
                issues += 1
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except:
            proc.kill()
        
    return issues

def main():
    parser = argparse.ArgumentParser(
        description="HALT — White Glove Lint Pass (maximum strictness)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--python", action="store_true", help="Python only (Ruff)")
    parser.add_argument("--js", action="store_true", help="JavaScript only (ESLint)")
    parser.add_argument("--html", action="store_true", help="HTML only (html-validate)")
    parser.add_argument("--shell", action="store_true", help="Shell only (ShellCheck)")
    parser.add_argument("--powershell", action="store_true", help="PowerShell only")
    parser.add_argument("--markdown", action="store_true", help="Markdown only (markdownlint)")
    parser.add_argument("--data", action="store_true", help="JSON/YAML only")
    parser.add_argument("--rust", action="store_true", help="Rust only (cargo clippy)")
    parser.add_argument("--hygiene", action="store_true", help="Run hygiene checks (whitespace, BOM)")
    parser.add_argument("--ml-benchmark", action="store_true", help="Automate ML prompts for speed reporting")
    parser.add_argument("--fix", action="store_true", help="Auto-fix where possible (Ruff)")
    parser.add_argument("--strict", action="store_true", help="Maximum strictness (ALL Ruff rules, style opinions)")
    args = parser.parse_args()

    # If no specific pass selected, run all
    run_all = not any(
        [
            args.python,
            args.js,
            args.html,
            args.shell,
            args.powershell,
            args.markdown,
            args.data,
            args.rust,
            args.hygiene,
            args.ml_benchmark,
        ]
    )

    banner()
    start = time.time()
    results = {}

    if run_all or args.python:
        results["Python (Ruff)"] = lint_python(fix=args.fix, strict=args.strict)

    if run_all or args.js:
        results["JavaScript (ESLint)"] = lint_javascript()

    if run_all or args.html:
        results["HTML (html-validate)"] = lint_html()

    if run_all or args.shell:
        results["Shell (ShellCheck)"] = lint_shell()

    if run_all or args.powershell:
        results["PowerShell"] = lint_powershell()

    if run_all or args.markdown:
        results["Markdown (markdownlint)"] = lint_markdown()

    if run_all or args.data:
        results["JSON / YAML"] = lint_data()
        
    if run_all or args.rust:
        results["Rust (Clippy)"] = lint_rust()

    if run_all or args.hygiene:
        results["Hygiene (ws/bom/eol)"] = lint_hygiene()

    if run_all or args.ml_benchmark:
        results["ML Benchmark"] = benchmark_models()

    elapsed = time.time() - start
    total = scoreboard(results)

    print(f"  Completed in {elapsed:.1f}s")
    print()

    sys.exit(0 if total == 0 else 1)


if __name__ == "__main__":
    main()
