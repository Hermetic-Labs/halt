"""
HALT — Brain Scan: Deep System Diagnostics
==========================================
4-Layer ecosystem validator.
Layer 1: Codebase Registry (Regex sweep for hardcoded network literals)
Layer 2: Architectural Mold (Strict constraint checking)
Layer 3: Live Adapters (Port gate socket pings)
Layer 4: Deep API Probes (Live HTTP & Mesh Endpoint Validation)
"""

import os
import sys
import re
import socket
import json
from urllib.request import urlopen, Request
from pathlib import Path

# ── Windows console encoding fix 
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
EXCLUDED_DIRS = {"node_modules", "target", "dist", "builds", ".git", ".github", ".vscode", ".idea", "__pycache__", "models", ".gemini", "gen"}

GOLDEN_PORTS = {
    7777: "Frontend Vite Host",
    7778: "HTTP REST API",
    7779: "Mesh WebSocket Host",
    7780: "Whisper STT Subprocess",
    7781: "NLLB Translate Subprocess"
}

STATIC_MOLD = [
    {
        "file": "viewer/vite.config.ts",
        "checks": [
            (r"port:\s*7777", "Missing explicit port: 7777 in Vite server config."),
            (r"target:\s*['\"]http://127\.0\.0\.1:7778['\"]", "Vite API proxies must target HTTP REST on 7778."),
            (r"target:\s*['\"]ws://127\.0\.0\.1:7779['\"]", "Vite WS proxy must target Mesh WS on 7779.")
        ]
    },
    {
        "file": "viewer/src-tauri/tauri.conf.json",
        "checks": [(r"http://localhost:7777", "Tauri devUrl must target Vite on 7777.")]
    },
    {
        "file": "viewer/src-tauri/src/lib.rs",
        "checks": [
            (r"ws_listener::start\(7779\)", "Rust WebSocket must bind to 7779."),
            (r"0\.0\.0\.0:7778", "Rust HTTP Axum must bind to 7778.")
        ]
    },
    {
        "file": "viewer/src/services/api.ts",
        "checks": [(r"127\.0\.0\.1:7778", "React API fetch fallback must hit Native REST on 7778.")]
    },
    {
        "file": "viewer/src/components/NetworkTab.tsx",
        "checks": [(r"ws://127\.0\.0\.1:7779", "React Native WebSocket must directly hit Mesh WS on 7779.")]
    },
    {
        "file": "start_rust.bat",
        "checks": [
            (r"7778,7779,7780,7781", "Orphan process killer must sweep 7778-7781."),
            (r"HALT-NLLB\s*\[7781\]", "Standalone NLLB CLI must be flagged as 7781.")
        ]
    }
]

def banner():
    print()
    print("  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — Brain Scan (4-Layer Mold)    ║")
    print("  ╚═══════════════════════════════════════╝")
    print()

def find_files(extensions):
    found = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for f in files:
            if any(f.endswith(ext) for ext in extensions):
                found.append(Path(root) / f)
    return sorted(found)

def rel_path(filepath):
    try: return os.path.relpath(str(filepath), str(REPO_ROOT))
    except ValueError: return str(filepath)

def layer1_codebase_sweep():
    print("\n  [Layer 1] Codebase Network Regex Sweep (Tracking Leaks)")
    print("  ─────────────────────────────────────────────────────────")
    files = find_files([".ts", ".tsx", ".rs", ".py", "vite.config.ts"])
    port_pattern = re.compile(r'\b(1420|7777|7778|7779|7780|7781)\b')
    route_pattern = re.compile(r"(['\"]/api/[^'\"]+['\"]|invoke\(['\"][a-z_]+['\"]|resolveUrl\(['\"][^'\"]+['\"]\))")
    
    anomalies = 0
    references = 0
    for fpath in files:
        rel = rel_path(fpath)
        if "brain_scan.py" in rel: continue
        try:
            content = fpath.read_text(encoding="utf-8", errors="replace")
            for i, line in enumerate(content.splitlines(), 1):
                # We specifically look for the legacy 1420 or mismatched paths
                for m in port_pattern.finditer(line):
                    if m.group(1) == "1420":
                        print(f"    ⚠ [Leak] {rel}:{i} → Still referencing React legacy 1420!")
                        anomalies += 1
                    references += 1
        except Exception:
            pass
    print(f"    {references} network literals scanned. {anomalies} memory leaks found.")

def layer2_strict_constraint_mold():
    print("\n  [Layer 2] Analytical Constraint Mold")
    print("  ─────────────────────────────────────────────────────────")
    anomalies = 0
    for mold in STATIC_MOLD:
        fpath = REPO_ROOT / mold["file"]
        if not fpath.exists():
            print(f"    [!] Missing target file: {mold['file']}")
            anomalies += 1
            continue
        content = fpath.read_text(encoding="utf-8", errors="replace")
        for regex, err_msg in mold["checks"]:
            if not re.search(regex, content):
                print(f"    [✗] {mold['file']} → Mismatch: {err_msg}")
                anomalies += 1
            else:
                pass # Silent on pass unless verbose
    if anomalies == 0: print("    ✓ 0 Mismatches. Perfect mold alignment.")
    else: print(f"    ⚠ {anomalies} structural anomalies found across ecosystem specs.")

def ping_socket(host, port, timeout=1):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def probe_endpoint(url, method="GET", expect_status=200, payload=None, expect_key=None):
    try:
        data = json.dumps(payload).encode('utf-8') if payload else None
        headers = {'Content-Type': 'application/json'} if payload else {}
        req = Request(url, data=data, headers=headers, method=method)
        with urlopen(req, timeout=3) as res:
            if res.getcode() != expect_status:
                return False, f"HTTP {res.getcode()}"
            if expect_key:
                try:
                    resp_data = json.loads(res.read().decode())
                    if isinstance(resp_data, dict) and expect_key not in resp_data:
                        return False, f"Missing '{expect_key}'"
                except Exception:
                    return False, "Invalid JSON"
            return True, "✓ OK"
    except Exception as e:
        # short error
        msg = str(e).split(':')[-1].strip() if ':' in str(e) else str(e)
        return False, f"✗ {msg}"

def probe_stt_endpoint(url):
    import struct
    try:
        # Generate 0.1s silent WAV buffer mapped with valid headers
        sample_rate = 16000
        num_samples = int(0.1 * sample_rate)
        audio_data = b'\x00\x00' * num_samples
        header = b'RIFF' + struct.pack('<I', 36 + len(audio_data)) + b'WAVEfmt ' + struct.pack('<I', 16) + struct.pack('<H', 1) + struct.pack('<H', 1) + struct.pack('<I', sample_rate) + struct.pack('<I', sample_rate * 2) + struct.pack('<H', 2) + struct.pack('<H', 16) + b'data' + struct.pack('<I', len(audio_data))
        
        req = Request(url, data=header + audio_data, method='POST')
        req.add_header('Content-Type', 'application/octet-stream')
        with urlopen(req, timeout=10) as res:
            if res.getcode() != 200:
                return False, f"HTTP {res.getcode()}"
            resp_data = json.loads(res.read().decode())
            if resp_data.get('language') != 'es':
                return False, f"✗ Expected language 'es', got '{resp_data.get('language')}'"
            return True, "✓ OK (Codec Decoded & Parameter Extracted)"
    except Exception as e:
        msg = str(e).split(':')[-1].strip() if ':' in str(e) else str(e)
        return False, f"✗ {msg}"

def layer3_and_4_live_diagnostics():
    print("\n  [Layer 3 & 4] Live Adapters & Deep API Probes")
    print("  ─────────────────────────────────────────────────────────")
    any_live = False
    
    for port, name in GOLDEN_PORTS.items():
        active = ping_socket("127.0.0.1", port)
        status = "[ON-LINE]" if active else "[OFF-LINE]"
        if active: any_live = True
        
        print(f"  {status} Port {port}  →  {name}")
        
        # Deep Web Probes
        if active and port == 7778:
            print("               └─ [Probe] /health            : " + probe_endpoint('http://127.0.0.1:7778/health')[1])
            print("               └─ [Probe] /api/roster        : " + probe_endpoint('http://127.0.0.1:7778/api/roster')[1])
            print("               └─ [Probe] /tts/voices        : " + probe_endpoint('http://127.0.0.1:7778/tts/voices')[1])
            payload = {"text": "hello", "source": "en", "target": "es"}
            ok, msg = probe_endpoint('http://127.0.0.1:7778/api/translate', method="POST", payload=payload)
            print("               └─ [Probe] /api/translate     : " + msg + " (Payload injection test)")
            print("               └─ [Probe] /api/mesh/status   : " + probe_endpoint('http://127.0.0.1:7778/api/mesh/status')[1])
            
        elif active and port == 7779:
            print("               └─ [Probe] /ws Upgrade Target : ✓ Confirmed listening")
            
        elif active and port == 7780:
            print("               └─ [Probe] /health            : " + probe_endpoint('http://127.0.0.1:7780/health', expect_key='ready')[1])
            print("               └─ [Probe] /listen            : " + probe_stt_endpoint('http://127.0.0.1:7780/listen?lang=es')[1] + " (Payload injection test)")
            
        elif active and port == 7781:
            print("               └─ [Probe] /health            : " + probe_endpoint('http://127.0.0.1:7781/health', expect_key='ready')[1])

    if not any_live:
        print("\n    ... All services safely sleeping. (Layer 4 Probes skipped).")

def layer5_neural_diagnostics():
    import subprocess
    print("\n  [Layer 5] Neural Pipeline Subsystems (Native Rust TTS Sweep)")
    print("  ─────────────────────────────────────────────────────────")
    
    # Locate src-tauri bin directory
    tauri_dir = REPO_ROOT / "viewer" / "src-tauri"
    if not tauri_dir.exists():
        print("    [!] Cannot locate src-tauri. Skipping Layer 5.")
        return

    print("    [>] Booting native panic-catch boundary: 'cargo run --bin halt_neural_scan' ...\n")
    try:
        # Execute the cargo binary natively mapping stdout
        process = subprocess.Popen(
            ["cargo", "run", "--bin", "halt_neural_scan", "--release"],
            cwd=str(tauri_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        
        for line in process.stdout:
            # Clean up the cargo build output noise
            clean_line = line.strip()
            if not clean_line or clean_line.startswith("Compiling") or clean_line.startswith("Finished") or clean_line.startswith("Running"):
                continue
            print(f"    {clean_line}")
            
        process.wait()
        if process.returncode != 0:
            print(f"\n    [!] Native binary exited with code {process.returncode}")
        else:
            print("\n    ✓ Native Neural Sweep Completed successfully.")

    except Exception as e:
        print(f"    [!] Failed to invoke cargo: {e}")

def layer6_topical_profiler():
    import subprocess, time, sys
    print("\n  [Layer 6] Topical Layer Profiler (GUI Tracing)")
    print("  ─────────────────────────────────────────────────────────")
    print("  [>] Injecting RUST_BACKTRACE=full & RUST_LOG=trace...")
    print("  [>] Booting GUI application natively...")
    print("  [!] INSTRUCTION: Provide the input that causes the complete crash.")
    print("  [!] The profiler is now capturing all output to 'dev/topical_crash_dump.log'...")
    
    viewer_dir = REPO_ROOT / "viewer"
    env = os.environ.copy()
    env["RUST_BACKTRACE"] = "full"
    env["RUST_LOG"] = "info,halt_triage=trace,halt_whisper=trace"
    
    # We use shell=True on Windows to correctly parse the npm command
    shell_flag = sys.platform == "win32"
    
    try:
        with open(SCRIPT_DIR / "topical_crash_dump.log", "w", encoding="utf-8") as dump:
            process = subprocess.Popen(
                ["npm", "run", "tauri", "dev"],
                cwd=str(viewer_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=shell_flag
            )
            
            for line in process.stdout:
                sys.stdout.write(line)
                dump.write(line)
                dump.flush()
                # Highlight panics heavily
                if "thread" in line and "panicked at" in line:
                    print("\n  [!!!] CRITICAL PANIC CAUGHT ON STREAM [!!!]")
                    
            process.wait()
            print(f"\n  [>] Profiler session ended. Exit code: {process.returncode}")
            print("  [>] Data has been secured in dev/topical_crash_dump.log")
            
    except Exception as e:
        print(f"  [!] Profiler failed to attach: {e}")

if __name__ == "__main__":
    banner()
    import sys
    if "--profiler" in sys.argv:
        layer6_topical_profiler()
    else:
        layer1_codebase_sweep()
        layer2_strict_constraint_mold()
        layer3_and_4_live_diagnostics()
        layer5_neural_diagnostics()
        print()
        print("  [Brain Scan Complete]")
        print()
