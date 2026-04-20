import sys
import os
import time
import requests
import base64

def run_test():
    print("Testing Translation Pipeline...")
    
    # 1. Translate English -> Arabic
    payload = {
        "text": "Hello doctor, I have a severe headache and need immediate medical assistance.",
        "source": "en",
        "target": "ar"
    }
    
    try:
        r = requests.post("http://127.0.0.1:7778/api/translate", json=payload, timeout=20)
        
        if r.status_code != 200:
            print(f"Translation HTTP Error: {r.status_code}")
            print(r.text)
            return
            
        data = r.json()
        translated = data.get("translated", "")
        print(f"\n[Translate] Result: {translated}")
    except Exception as e:
        print(f"Translate Exception: {e}")
        return
        
    # 2. TTS Arabic Synthesis
    tts_payload = {
        "text": translated,
        "voice": "af_heart",
        "speed": 1.0,
        "lang": "ar"
    }
    
    print("\n[TTS] Synthesizing translated text...")
    try:
        r2 = requests.post("http://127.0.0.1:7778/tts/synthesize", json=tts_payload, timeout=20)
        
        if r2.status_code != 200:
            print(f"TTS HTTP Error: {r2.status_code}")
            print(r2.text)
            return
            
        tts_data = r2.json()
        b64 = tts_data.get("audio_base64", "")
        duration = tts_data.get("duration_ms", 0)
        print(f"[TTS] Success! Audio Base64 Length: {len(b64)}, Duration: {duration}ms")
        
    except Exception as e:
        print(f"TTS Exception: {e}")

if __name__ == "__main__":
    run_test()
