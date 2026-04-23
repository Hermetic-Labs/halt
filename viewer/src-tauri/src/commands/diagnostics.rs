use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct LanguageTruth {
    pub ui_code: String,
    pub bcp47_code: String,
    pub expected_translation: String,
    pub expected_char_count: usize,
    pub kokoro_voice: String,
    pub expected_ipa_prefix: String,
}

#[derive(Serialize)]
pub struct SweepResult {
    pub target: String,
    pub bcp47: String,
    pub nllb_status: bool,
    pub nllb_output: String,
    pub nllb_char_count: usize,
    pub translation_error: Option<String>,
    pub expected_char_count: usize,
    pub mapping_match: bool,
    pub phonemizer_status: bool,
    pub phonemizer_ipa: Option<String>,
    pub phonemizer_compiled_ipa: Option<String>,
    pub phonemizer_tokens: usize,
    pub phonemizer_error: Option<String>,
    pub tts_status: bool,
    pub audio_length: usize,
    pub tts_error: Option<String>,
}

fn brocas_area() -> Vec<LanguageTruth> {
    let voices = crate::models::kokoro::voice_map();
    let default_voice = "af_heart";

    let truths = vec![
        // Baseline
        ("en", "eng_Latn", "All medics must report to ward alpha immediately", 48, ""),

        // Right-to-Left / Complex Scripts
        ("ar", "arb_Arab", "يجب على جميع المسعفين إبلاغ الجناح ألفا على الفور", 49, ""),
        ("he", "heb_Hebr", "", 0, ""),
        ("fa", "pes_Arab", "همه پزشکان باید فوراً به بخش آلفا گزارش دهند", 44, ""),
        ("ur", "urd_Arab", "", 0, ""),
        ("ps", "pbt_Arab", "ټول ډاکټران باید ژر تر ژره د الفا وارډ ته راپور ورکړي", 53, ""),
        ("ku", "ckb_Arab", "", 0, ""),

        // Asian / Character-based
        ("zh", "zho_Hans", "所有医务人员立即向alpha病房报到", 17, ""),
        ("ja", "jpn_Jpan", "", 0, ""),
        ("ko", "kor_Hang", "모든 의료진은 즉시 알파 병동에 보고해야 합니다", 26, ""),
        ("th", "tha_Thai", "บุคลากรทางการแพทย์ทุกคนรายงานตัวที่วอร์ดอัลฟ่าทันที", 51, ""),
        ("vi", "vie_Latn", "", 0, ""),

        // Indic / African / Cyrillic / Other
        ("hi", "hin_Deva", "सभी डॉक्टरों को तुरंत वार्ड अल्फा को रिपोर्ट करना चाहिए", 54, ""),
        ("bn", "ben_Beng", "", 0, ""),
        ("ta", "tam_Taml", "", 0, ""),
        ("am", "amh_Ethi", "ሁሉም የህክምና ባለሙያዎች ወዲያውኑ ወደ ዋርድ አልፋ ሪፖርት ያደርጋሉ", 45, ""),
        ("ru", "rus_Cyrl", "Все медики немедленно сообщают в отделение альфа", 48, ""),
        ("uk", "ukr_Cyrl", "", 0, ""),

        // Latin based
        ("es", "spa_Latn", "", 0, ""),
        ("fr", "fra_Latn", "", 0, ""),
        ("de", "deu_Latn", "", 0, ""),
        ("it", "ita_Latn", "", 0, ""),
        ("pt", "por_Latn", "", 0, ""),
        ("nl", "nld_Latn", "", 0, ""),
        ("tr", "tur_Latn", "", 0, ""),
        ("pl", "pol_Latn", "", 0, ""),
        ("id", "ind_Latn", "", 0, ""),
        ("sw", "swh_Latn", "", 0, ""),
        ("ha", "hau_Latn", "", 0, ""),
        ("so", "som_Latn", "", 0, ""),
    ];

    truths.into_iter().map(|(ui, bcp47, trans, count, ipa)| {
        let voice = voices.get(ui).copied().unwrap_or(default_voice);
        LanguageTruth {
            ui_code: ui.into(),
            bcp47_code: bcp47.into(),
            expected_translation: trans.into(),
            expected_char_count: count,
            kokoro_voice: voice.into(),
            expected_ipa_prefix: ipa.into(),
        }
    }).collect()
}

#[tauri::command]
pub async fn run_neural_sweep() -> Result<Vec<SweepResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let english_source = "All medics must report to ward alpha immediately";
        let truths = brocas_area();
        let mut results = Vec::new();

        // Sidecar check
        let _ = crate::models::nllb::ensure_loaded();

        for truth in truths {
            let mut sweep = SweepResult {
                target: truth.ui_code.clone(),
                bcp47: truth.bcp47_code.clone(),
                nllb_status: false,
                nllb_output: String::new(),
                nllb_char_count: 0,
                translation_error: None,
                expected_char_count: truth.expected_char_count,
                mapping_match: false,
                phonemizer_status: false,
                phonemizer_ipa: None,
                phonemizer_compiled_ipa: None,
                phonemizer_tokens: 0,
                phonemizer_error: None,
                tts_status: false,
                audio_length: 0,
                tts_error: None,
            };

            // 1. NLLB Translation (must use BCP-47 for direct NLLB boundary)
            let translation_result = std::panic::catch_unwind(|| {
                crate::models::nllb::translate(english_source, "eng_Latn", &truth.bcp47_code)
            });

            let mut next_step_text = String::new();

            match translation_result {
                Ok(Ok(text)) => {
                    sweep.nllb_status = true;
                    sweep.nllb_output = text.clone();
                    sweep.nllb_char_count = text.chars().count();
                    sweep.mapping_match = truth.expected_char_count == 0 || (sweep.nllb_char_count == truth.expected_char_count);
                    next_step_text = text;
                },
                Ok(Err(e)) => sweep.translation_error = Some(e.to_string()),
                Err(e) => {
                    let panic_msg = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown Object".into() };
                    sweep.translation_error = Some(format!("Panic: {}", panic_msg));
                }
            }

            if !sweep.nllb_status || next_step_text.is_empty() {
                results.push(sweep);
                continue;
            }

            // 2. Phonemizer Mapping
            let (processed, effective_lang) = crate::commands::tts::preprocess_text(&next_step_text, &truth.ui_code);
            
            // Explicitly evaluate and capture the raw string for the Sandbox
            if let Ok(ipa_str) = crate::models::phonemizer::text_to_ipa(&processed, &effective_lang) {
                sweep.phonemizer_ipa = Some(ipa_str);
            }

            let tokens = std::panic::catch_unwind(|| {
                crate::models::phonemizer::text_to_tokens(&processed, &effective_lang)
            });

            match tokens {
                Ok(Ok(t)) => {
                    if t.len() == 1 && t[0] == 0 {
                        sweep.phonemizer_status = false;
                        sweep.phonemizer_error = Some("Fallback vec![0] triggered".into());
                    } else {
                        sweep.phonemizer_status = true;
                        sweep.phonemizer_tokens = t.len();
                    }
                },
                Ok(Err(e)) => sweep.phonemizer_error = Some(e.to_string()),
                Err(e) => {
                    let panic_msg = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown Object".into() };
                    sweep.phonemizer_error = Some(format!("Panic: {}", panic_msg));
                }
            }

            // 3. TTS Tensor Synthesis
            let req = crate::commands::tts::SynthesizeRequest {
                text: next_step_text.clone(),
                voice: truth.kokoro_voice.clone(),
                speed: 1.0,
                lang: truth.ui_code.clone(),
            };

            let tts_result = std::panic::catch_unwind(|| {
                crate::commands::tts::tts_synthesize(req)
            });

            match tts_result {
                Ok(Ok(resp)) => {
                    sweep.tts_status = true;
                    sweep.audio_length = resp.audio_base64.len();
                },
                Ok(Err(err)) => sweep.tts_error = Some(err.to_string()),
                Err(e) => {
                    let panic_msg = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown Object".into() };
                    sweep.tts_error = Some(format!("Panic: {}", panic_msg));
                }
            }

            results.push(sweep);
        }

        results
    })
    .await
    .map_err(|e| format!("Tauri thread panicked: {}", e))
}

#[tauri::command]
pub async fn run_language_probe(text: String, ui_code: String) -> Result<SweepResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let truth = brocas_area().into_iter().find(|t| t.ui_code == ui_code)
            .ok_or_else(|| format!("Language code {} not natively supported in scanner map", ui_code))?;

        let mut sweep = SweepResult {
            target: truth.ui_code.clone(),
            bcp47: truth.bcp47_code.clone(),
            nllb_status: false,
            nllb_output: String::new(),
            nllb_char_count: 0,
            translation_error: None,
            expected_char_count: 0, // Bypass static limits on custom user text
            mapping_match: false,
            phonemizer_status: false,
            phonemizer_ipa: None,
            phonemizer_compiled_ipa: None,
            phonemizer_tokens: 0,
            phonemizer_error: None,
            tts_status: false,
            audio_length: 0,
            tts_error: None,
        };

        let translation_result = std::panic::catch_unwind(|| {
            crate::models::nllb::translate(&text, "eng_Latn", &truth.bcp47_code)
        });

        let mut next_step_text = text.clone();
        match translation_result {
            Ok(Ok(translated_text)) => {
                sweep.nllb_status = true;
                sweep.nllb_output = translated_text.clone();
                sweep.nllb_char_count = translated_text.chars().count();
                next_step_text = translated_text;
            },
            Ok(Err(e)) => sweep.translation_error = Some(e),
            Err(e) => {
                let p = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown".into() };
                sweep.translation_error = Some(format!("Panic: {}", p));
            }
        }

        if !sweep.nllb_status || next_step_text.is_empty() {
            return Ok(sweep);
        }

        let (processed, effective_lang) = crate::commands::tts::preprocess_text(&next_step_text, &truth.ui_code);
        
        if let Ok(ipa_str) = crate::models::phonemizer::text_to_ipa(&processed, &effective_lang) {
            sweep.phonemizer_ipa = Some(ipa_str.clone());
            sweep.phonemizer_compiled_ipa = Some(crate::models::phoneme_compiler::compile(&ipa_str, &truth.ui_code));
        }

        let tokens = std::panic::catch_unwind(|| {
            crate::models::phonemizer::text_to_tokens(&processed, &effective_lang)
        });

        match tokens {
            Ok(Ok(t)) => {
                if t.len() == 1 && t[0] == 0 {
                    sweep.phonemizer_status = false;
                    sweep.phonemizer_error = Some("Fallback vec![0] triggered".into());
                } else {
                    sweep.phonemizer_status = true;
                    sweep.phonemizer_tokens = t.len();
                }
            },
            Ok(Err(e)) => sweep.phonemizer_error = Some(e),
            Err(e) => {
                let p = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown".into() };
                sweep.phonemizer_error = Some(format!("Panic: {}", p));
            }
        }

        let req = crate::commands::tts::SynthesizeRequest {
            text: next_step_text,
            voice: truth.kokoro_voice.clone(),
            speed: 1.0,
            lang: truth.ui_code.clone(),
        };

        let tts_result = std::panic::catch_unwind(|| {
            crate::commands::tts::tts_synthesize(req)
        });

        match tts_result {
            Ok(Ok(resp)) => {
                sweep.tts_status = true;
                sweep.audio_length = resp.audio_base64.len();
            },
            Ok(Err(err)) => sweep.tts_error = Some(err),
            Err(e) => {
                let p = if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = e.downcast_ref::<String>() { s.clone() } else { "Unknown".into() };
                sweep.tts_error = Some(format!("Panic: {}", p));
            }
        }

        Ok(sweep)
    })
    .await
    .map_err(|e| format!("Tauri thread panicked: {}", e))?
}
