const http = require('http');
async function run() {
    const langs = ['ar', 'zh', 'am', 'ru', 'es', 'fa'];
    
    for (const lang of langs) {
        console.log('\n--- Testing ' + lang + ' ---');
        try {
            const trRes = await fetch('http://127.0.0.1:7778/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({text: 'All medics report to ward alpha immediately', source: 'en', target: lang})
            });
            const tr = await trRes.json();
            console.log('Translated: ' + tr.translated);

            const ttsRes = await fetch('http://127.0.0.1:7778/tts/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({text: tr.translated, lang: lang, speed: 1.0, voice: 'af_heart'})
            });
            const tts = await ttsRes.json();
            console.log('TTS Audio Size: ' + (tts.audio_base64 ? tts.audio_base64.length : 0));
        } catch (err) {
            console.error('CRASH: ' + err.message);
        }
    }
}
run();