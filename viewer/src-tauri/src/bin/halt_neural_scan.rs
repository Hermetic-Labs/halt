fn main() {
    println!("[SWEEP] Starting native TTS sweep...");
    
    let translations = vec![
        ("ar", "يجب على جميع المسعفين إبلاغ الجناح ألفا على الفور"),
        ("zh", "所有医务人员立即向alpha病房报到"),
        ("am", "ሁሉም የህክምና ባለሙያዎች ወዲያውኑ ወደ ዋርድ አልፋ ሪፖርት ያደርጋሉ"),
        ("ru", "Все медики немедленно сообщают в отделение альфа"),
        ("fa", "همه پزشکان باید فوراً به بخش آلفا گزارش دهند"),
        ("hi", "सभी डॉक्टरों को तुरंत वार्ड अल्फा को रिपोर्ट करना चाहिए"),
        ("th", "บุคลากรทางการแพทย์ทุกคนรายงานตัวที่วอร์ดอัลฟ่าทันที"),
        ("ko", "모든 의료진은 즉시 알파 병동에 보고해야 합니다"),
        ("ps", "ټول ډاکټران باید ژر تر ژره د الفا وارډ ته راپور ورکړي"),
    ];

    let mut success_count = 0;
    for (lang, text) in translations {
        println!("\n------------------------------------------------");
        println!("[SWEEP] Testing lang: {}", lang);
        
        let (processed, effective_lang) = app_lib::commands::tts::preprocess_text(text, lang);
        println!("[SWEEP] Preprocessed: '{}', effective_lang: {}", processed, effective_lang);

        let tokens = std::panic::catch_unwind(|| {
            app_lib::models::phonemizer::text_to_tokens(&processed, &effective_lang)
        });
        
        match tokens {
            Ok(Ok(t)) => println!("[SWEEP] Phonemized successfully: {} tokens", t.len()),
            Ok(Err(e)) => println!("[SWEEP] Phonemization returned Err: {}", e),
            Err(_) => println!("[SWEEP] CRASH (Panic) during phonemization!"),
        }
        
        let req = app_lib::commands::tts::SynthesizeRequest {
            text: text.to_string(),
            voice: "af_heart".to_string(),
            speed: 1.0,
            lang: lang.to_string(),
        };

        let result = std::panic::catch_unwind(|| {
            app_lib::commands::tts::tts_synthesize(req)
        });

        match result {
            Ok(Ok(resp)) => {
                println!("[SWEEP] TTS PASSED! Audio len: {}", resp.audio_base64.len());
                success_count += 1;
            },
            Ok(Err(err)) => {
                println!("[SWEEP] TTS Err Result: {}", err);
            },
            Err(_) => {
                println!("[SWEEP] CRASH (Panic) inside tts_synthesize!");
            }
        }
    }
    
    println!("\n------------------------------------------------");
    println!("[SWEEP] Completed. {}/9 succeeded.", success_count);
}