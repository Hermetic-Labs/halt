//! Phonemizer — text → IPA phonemes → Kokoro token IDs.
//!
//! Uses espeak-ng (via subprocess) to convert text to IPA phonemes,
//! then maps those phonemes to Kokoro's 178-token vocabulary.
//!
//! This avoids compiling espeak-ng from C source (espeakng-sys) which
//! doesn't support Windows well. Instead we shell out to the installed
//! espeak-ng binary, which exists at `C:\Program Files\eSpeak NG\espeak-ng.exe`
//! on Windows and `/usr/bin/espeak-ng` on Linux/macOS.

use std::collections::HashMap;
use std::process::Command;
use std::sync::OnceLock;

/// Kokoro phoneme vocabulary — maps IPA characters to token IDs.
/// Extracted from Kokoro-82M config.json (178 tokens).
fn vocab() -> &'static HashMap<char, i64> {
    static VOCAB: OnceLock<HashMap<char, i64>> = OnceLock::new();
    VOCAB.get_or_init(|| {
        let mut m = HashMap::new();
        m.insert(';', 1);
        m.insert(':', 2);
        m.insert(',', 3);
        m.insert('.', 4);
        m.insert('!', 5);
        m.insert('?', 6);
        m.insert('—', 9);
        m.insert('…', 10);
        m.insert('"', 11);
        m.insert('(', 12);
        m.insert(')', 13);
        m.insert('\u{201C}', 14); // "
        m.insert('\u{201D}', 15); // "
        m.insert(' ', 16);
        m.insert('\u{0303}', 17); // combining tilde
        m.insert('ʣ', 18);
        m.insert('ʥ', 19);
        m.insert('ʦ', 20);
        m.insert('ʨ', 21);
        m.insert('ᵝ', 22);
        m.insert('\u{AB67}', 23);
        m.insert('A', 24);
        m.insert('I', 25);
        m.insert('O', 31);
        m.insert('Q', 33);
        m.insert('S', 35);
        m.insert('T', 36);
        m.insert('W', 39);
        m.insert('Y', 41);
        m.insert('ᵊ', 42);
        m.insert('a', 43);
        m.insert('b', 44);
        m.insert('c', 45);
        m.insert('d', 46);
        m.insert('e', 47);
        m.insert('f', 48);
        m.insert('h', 50);
        m.insert('i', 51);
        m.insert('j', 52);
        m.insert('k', 53);
        m.insert('l', 54);
        m.insert('m', 55);
        m.insert('n', 56);
        m.insert('o', 57);
        m.insert('p', 58);
        m.insert('q', 59);
        m.insert('r', 60);
        m.insert('s', 61);
        m.insert('t', 62);
        m.insert('u', 63);
        m.insert('v', 64);
        m.insert('w', 65);
        m.insert('x', 66);
        m.insert('y', 67);
        m.insert('z', 68);
        m.insert('ɑ', 69);
        m.insert('ɐ', 70);
        m.insert('ɒ', 71);
        m.insert('æ', 72);
        m.insert('β', 75);
        m.insert('ɔ', 76);
        m.insert('ɕ', 77);
        m.insert('ç', 78);
        m.insert('ɖ', 80);
        m.insert('ð', 81);
        m.insert('ʤ', 82);
        m.insert('ə', 83);
        m.insert('ɚ', 85);
        m.insert('ɛ', 86);
        m.insert('ɜ', 87);
        m.insert('ɟ', 90);
        m.insert('ɡ', 92);
        m.insert('ɥ', 99);
        m.insert('ɨ', 101);
        m.insert('ɪ', 102);
        m.insert('ʝ', 103);
        m.insert('ɯ', 110);
        m.insert('ɰ', 111);
        m.insert('ŋ', 112);
        m.insert('ɳ', 113);
        m.insert('ɲ', 114);
        m.insert('ɴ', 115);
        m.insert('ø', 116);
        m.insert('ɸ', 118);
        m.insert('θ', 119);
        m.insert('œ', 120);
        m.insert('ɹ', 123);
        m.insert('ɾ', 125);
        m.insert('ɻ', 126);
        m.insert('ʁ', 128);
        m.insert('ɽ', 129);
        m.insert('ʂ', 130);
        m.insert('ʃ', 131);
        m.insert('ʈ', 132);
        m.insert('ʧ', 133);
        m.insert('ʊ', 135);
        m.insert('ʋ', 136);
        m.insert('ʌ', 138);
        m.insert('ɣ', 139);
        m.insert('ɤ', 140);
        m.insert('χ', 142);
        m.insert('ʎ', 143);
        m.insert('ʒ', 147);
        m.insert('ʔ', 148);
        m.insert('ˈ', 156);
        m.insert('ˌ', 157);
        m.insert('ː', 158);
        m.insert('ʰ', 162);
        m.insert('ʲ', 164);
        m.insert('↓', 169);
        m.insert('→', 171);
        m.insert('↗', 172);
        m.insert('↘', 173);
        m.insert('ᵻ', 177);
        m
    })
}

/// Preprocess text for Kokoro.
/// Previously, we filtered unsupported languages into English ASCII strings.
/// Now, we leave the native scripts intact so espeak-ng can generate accurate phonemes natively.
fn preprocess_text(text: &str, _lang: &str) -> String {
    text.to_string()
}

/// Map UI language code → espeak-ng voice code.
fn espeak_voice(lang: &str) -> &'static str {
    match lang {
        "en" => "en-us",
        "es" => "es",
        "fr" => "fr-fr",
        "hi" => "hi",
        "it" => "it",
        "pt" => "pt-br",
        "zh" => "cmn",
        "ja" => "en-us", // Japanese Romaji handled via Kokoro's native english model usually
        "ar" => "ar",
        "ru" => "ru",
        "fa" => "fa",
        "ko" => "ko",
        "de" => "de",
        _ => "en-us",
    }
}

/// Find espeak-ng executable strictly bundled within the repository's native runtime context.
pub fn find_espeak() -> Option<String> {
    // Resolve relative to the executable (to find C:\Halt\runtime)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(src_tauri) = exe_path.ancestors().find(|p| p.join("Cargo.toml").exists() || p.file_name().unwrap_or_default() == "src-tauri") {
            let halt_root = src_tauri.parent().and_then(|p| p.parent()).unwrap_or(src_tauri);
            let local_espeak = halt_root.join("runtime").join("espeak-ng").join("espeak-ng.exe");
            
            if local_espeak.exists() {
                return Some(local_espeak.to_string_lossy().to_string());
            }
        }
    }
    
    // Hard fallback just in case we are in dev/hot-reload
    let fallback = std::path::PathBuf::from("C:\\Halt\\runtime\\espeak-ng\\espeak-ng.exe");
    if fallback.exists() {
        return Some(fallback.to_string_lossy().to_string());
    }

    None
}

/// Convert text to IPA phonemes using espeak-ng subprocess.
pub fn text_to_ipa(raw_text: &str, lang: &str) -> Result<String, String> {
    let espeak = find_espeak().unwrap_or_else(|| "espeak-ng".to_string());
    let voice = espeak_voice(lang);
    let text = preprocess_text(raw_text, lang);

    use std::io::Write;
    let mut child = Command::new(&espeak)
        .args(["-v", voice, "--ipa", "-q"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("espeak-ng failed to spawn: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| format!("espeak-ng stdin write failed: {}", e))?;
    }

    let output = child.wait_with_output()
        .map_err(|e| format!("espeak-ng failed to execute: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("espeak-ng error: {}", stderr));
    }

    let ipa = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::debug!("espeak-ng [{}]: '{}' → '{}'", voice, &text[..text.len().min(60)], &ipa[..ipa.len().min(80)]);
    Ok(ipa)
}


/// Convert text to Kokoro token IDs.
/// Pipeline: text → espeak-ng IPA → vocab lookup → token IDs.
pub fn text_to_tokens(text: &str, lang: &str) -> Result<Vec<i64>, String> {
    let ipa_raw = text_to_ipa(text, lang)?;
    
    // Extricate language-switch tags like (en) and (cmn) natively injected by espeak-ng.
    // If we don't do this, Kokoro TTS interprets "()" and "en" as literal phonetic english to speak.
    let mut ipa_raw_clean = String::with_capacity(ipa_raw.len());
    let mut in_tag = false;
    for ch in ipa_raw.chars() {
        if ch == '(' {
            in_tag = true;
        } else if ch == ')' && in_tag {
            in_tag = false;
        } else if !in_tag {
            ipa_raw_clean.push(ch);
        }
    }

    let ipa = ipa_raw_clean
        .replace('g', "ɡ")   // standard g -> script ɡ
        .replace('ħ', "h")   // Arabic voiceless pharyngeal fricative -> h
        .replace('ʕ', "ʔ")   // Arabic voiced pharyngeal fricative -> glottal stop
        .replace("dʒ", "ʤ")  // Affricates
        .replace("tʃ", "ʧ")
        .replace("ts", "ʦ")
        .replace("dz", "ʣ")
        .replace("tɕ", "ʨ")
        .replace("dʑ", "ʥ")
        .replace('ˤ', "")    // Remove unsupported pharyngealization markers
        .replace('̃', "");    // Remove unsupported nasalization waves

    let v = vocab();

    // NFD decompose IPA so precomposed characters (e.g. ǐ U+01D0) split into
    // base letter + combining diacritic (i + ̌).  The base letter hits the vocab;
    // the combining mark is harmlessly skipped.  Without this, espeak-ng output
    // for Chinese/Arabic/Thai loses most syllables during vocab lookup.
    use unicode_normalization::UnicodeNormalization;
    let ipa_nfd: String = ipa.nfd().collect();

    // Start with padding token (0)
    let mut tokens: Vec<i64> = vec![0];

    for ch in ipa_nfd.chars() {
        if let Some(&id) = v.get(&ch) {
            tokens.push(id);
        }
        // else skip characters not in vocab
    }

    // End with padding token (0)
    tokens.push(0);

    // Kokoro absolute max sequence length is 510 tokens
    if tokens.len() > 510 {
        tokens.truncate(509);
        tokens.push(0);
    }

    // Guard: if we only have the two bookend padding tokens [0, 0] with nothing
    // between them, phonemization produced zero usable phonemes — return Err so
    // callers can decide what to do.  Any real phoneme (3+ tokens) is fine.
    if tokens.len() <= 2 {
        return Err(format!(
            "No phoneme tokens produced. IPA was: '{}'",
            &ipa[..ipa.len().min(80)]
        ));
    }

    log::info!(
        "Phonemized: {} chars → {} IPA → {} tokens",
        text.len(),
        ipa.len(),
        tokens.len()
    );

    Ok(tokens)
}
