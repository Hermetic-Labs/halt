"""Phase 3 — ML endpoint verification against the Python sidecar.

Tests the exact same endpoints that resolveUrl() and the typed helpers hit,
verifying the fallback path that the store build will use.
"""
import urllib.request, json, time, sys

BASE = "http://127.0.0.1:7778"
results = []


def test(label, path, method="GET", body=None, check=None):
    url = f"{BASE}{path}"
    t0 = time.time()
    try:
        if body:
            data = json.dumps(body).encode()
            req = urllib.request.Request(url, data=data,
                                         headers={"Content-Type": "application/json"},
                                         method=method)
        else:
            req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            elapsed = (time.time() - t0) * 1000
            ct = resp.headers.get('Content-Type', '')
            if 'json' in ct and raw:
                result = json.loads(raw)
            else:
                result = {'_raw_len': len(raw), '_content_type': ct}
            ok = True
            detail = ""
            if check:
                ok, detail = check(result)
            results.append((label, resp.status, elapsed, ok, detail))
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        results.append((label, "ERR", elapsed, False, str(e)[:60]))


# ── 3.1  translate_text (single) ──
test("3.1 translate_text", "/api/translate", "POST",
     body={"text": "hello world", "source": "en", "target": "es"},
     check=lambda r: (bool(r.get("translated")),
                      f"got: {r.get('translated', '(empty)')[:40]}"))

# ── 3.2  translate_batch ──
test("3.2 translate_batch", "/api/translate/batch", "POST",
     body={"texts": ["good morning", "thank you"], "source": "en", "target": "fr"},
     check=lambda r: (isinstance(r.get("translations"), list) and len(r["translations"]) == 2,
                      f"got {len(r.get('translations', []))} items: {r.get('translations', [])}"))

# ── 3.3  tts_synthesize ──
test("3.3 tts_synthesize", "/tts/synthesize", "POST",
     body={"text": "test", "voice": "af_heart", "rate": 1.0, "lang": "en"},
     check=lambda r: (r.get('_raw_len', 0) > 100 or bool(r.get('audio_base64')),
                      f"size={r.get('_raw_len','?')}B, ct={r.get('_content_type','?')}, keys={list(r.keys())}"))

# ── 3.4  stt_listen (health only — no mic available) ──
test("3.4 stt_health", "/stt/health",
     check=lambda r: (True, f"status={r.get('status', r)}"))

# ── 3.5  inference_health ──
test("3.5 inference_health", "/api/inference/health",
     check=lambda r: (True, f"keys={list(r.keys())}"))

# ── 3.6  translate_status ──
test("3.6 translate_status", "/api/translate/status",
     check=lambda r: (True, f"model={r.get('model','?')}, loaded={r.get('loaded','?')}"))

# ── 3.7  tts_voices ──
test("3.7 tts_voices", "/tts/voices",
     check=lambda r: (isinstance(r, (list, dict)),
                      f"type={type(r).__name__}, count={len(r) if isinstance(r, list) else len(r.get('voices', r))}"))

# ── 3.8  health (full) ──
test("3.8 health_full", "/health",
     check=lambda r: (True,
                      f"whisper={r.get('whisper','?')}, gguf={len(r.get('gguf', []))} models"))


# ── Print ──
print()
print(f"  {'#':<22} {'STATUS':>6}  {'MS':>7}  {'OK':>4}  DETAIL")
print(f"  {'-'*22} {'-'*6}  {'-'*7}  {'-'*4}  {'-'*40}")
passed = failed = 0
for label, status, ms, ok, detail in results:
    mark = "PASS" if ok else "FAIL"
    if ok: passed += 1
    else: failed += 1
    print(f"  {label:<22} {str(status):>6}  {ms:>6.0f}ms  {mark:<4}  {detail[:50]}")
print()
print(f"  TOTAL: {passed} passed, {failed} failed out of {len(results)}")
