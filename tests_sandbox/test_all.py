import urllib.request
import json
import time

for lang in ['ar', 'am', 'zh', 'ru']:
    print(f'\n--- Testing {lang} ---')
    data = json.dumps({'text': 'All medics report to ward alpha immediately', 'source': 'en', 'target': lang}).encode('utf-8')
    req = urllib.request.Request('http://localhost:7778/api/translate', data=data, headers={'Content-Type': 'application/json'})
    response = urllib.request.urlopen(req)
    translated = json.loads(response.read())['translated']
    print('Translated:', translated)

    tts_data = json.dumps({'text': translated, 'lang': lang, 'speed': 1.0, 'voice': 'af_heart'}).encode('utf-8')
    req2 = urllib.request.Request('http://localhost:7778/tts/synthesize', data=tts_data, headers={'Content-Type': 'application/json'})
    time.sleep(0.5)
    
    try:
        response2 = urllib.request.urlopen(req2)
        output2 = json.loads(response2.read())
        print('TTS Audio Size:', len(output2.get('audio_base64', '')))
    except Exception as e:
        print(f'CRASH on {lang}:', e)