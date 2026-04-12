"""Backend E2E test — hits every critical endpoint."""
import urllib.request
import json
import time

BASE = "http://127.0.0.1:7778"
results = []


def check(label, path, method="GET", expect_status=200, body=None):
    url = f"{BASE}{path}"
    t0 = time.time()
    try:
        if body:
            data = json.dumps(body).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
        else:
            req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            resp.read()
            elapsed = (time.time() - t0) * 1000
            ok = status == expect_status
            results.append((label, status, elapsed, ok))
    except urllib.error.HTTPError as e:
        elapsed = (time.time() - t0) * 1000
        ok = e.code == expect_status
        results.append((label, e.code, elapsed, ok))
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        results.append((label, str(e)[:30], elapsed, False))


# ── Health (MUST be 200 now — no more 503) ──
check("Health", "/health")
check("API Health", "/api/health")

# ── Patient CRUD ──
patient = {
    "id": "PAT-E2E-TEST",
    "name": "E2E Test Child",
    "age": 8,
    "sex": "F",
    "admittedAt": "2025-01-01T00:00:00",
    "status": "active",
    "triage": {"priority": "T1", "priorityLabel": "Immediate", "hemoClass": "III", "gcsCat": "Moderate"},
    "initialVitals": {"hr": 120, "sbp": 90, "rr": 22, "spo2": 95, "gcs": 13, "temp": 38.2, "pain": 7},
    "plan": {"march": [], "drugs": [], "rx": [], "recovery": [], "escalate": []},
}
check("Create Patient", "/api/patients", method="POST", expect_status=201, body=patient)
check("Get Patient", "/api/patients/PAT-E2E-TEST")
check("List Patients", "/api/patients")

# ── TTS ──
check("TTS Health", "/tts/health")
check("TTS Voices", "/tts/voices")
check("TTS Synthesize", "/tts/synthesize", method="POST", body={"text": "Testing one two three", "voice": "af_heart", "rate": 1.0, "lang": "en"})

# ── STT ──
check("STT Health", "/stt/health")

# ── Translate ──
check("Translate Status", "/api/translate/status")

# ── Inference ──
check("Inference Health", "/api/inference/health")

# ── Distribution ──
check("Distribution Status", "/api/distribution/status")

# ── Export ──
check("Patient PDF", "/api/patients/PAT-E2E-TEST/pdf")
check("Patient HTML Export", "/api/patients/PAT-E2E-TEST/export?lang=en")
check("Shift Report", "/api/reports/shift")

# ── Cleanup ──
check("Delete Patient", "/api/patients/PAT-E2E-TEST", method="DELETE", expect_status=204)

# ── Print results ──
print()
hdr = f"  {'ENDPOINT':<25} {'STATUS':>6}  {'MS':>7}  RESULT"
print(hdr)
print(f"  {'-'*25} {'-'*6}  {'-'*7}  ------")
passed = 0
failed = 0
for label, status, ms, ok in results:
    mark = "PASS" if ok else "FAIL <<<<<"
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  {label:<25} {str(status):>6}  {ms:>6.0f}ms  {mark}")
print()
print(f"  TOTAL: {passed} passed, {failed} failed out of {len(results)}")
if failed == 0:
    print("  ALL PASS ✓")
else:
    print(f"  {failed} FAILURES ✗")
