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

/// Map UI language code → espeak-ng voice code.
/// Port of ESPEAK_LANG_MAP from tts.py.
fn espeak_voice(lang: &str) -> &'static str {
    match lang {
        "en" => "en-us",
        "es" => "es",
        "fr" => "fr-fr",
        "ar" => "ar",
        "bn" => "bn",
        "de" => "de",
        "hi" => "hi",
        "id" => "id",
        "it" => "it",
        "ja" => "en-us", // Japanese → romaji → English voice
        "ko" => "ko",
        "nl" => "nl",
        "pl" => "pl",
        "pt" => "pt-br",
        "ru" => "ru",
        "sw" => "sw",
        "th" => "th",
        "tr" => "tr",
        "ur" => "ur",
        "vi" => "vi",
        "zh" => "cmn",
        "am" => "am",
        "ha" => "en-us",
        "ku" => "ku",
        "mr" => "mr",
        "my" => "my",
        "ta" => "ta",
        "te" => "te",
        "uk" => "uk",
        "he" => "he",
        "la" => "la",
        "tl" => "en-us",
        "ig" => "en-us",
        "jw" => "id",
        "mg" => "fr-fr",
        "ps" => "fa",
        "so" => "sw",
        "yo" => "en-us",
        "zu" => "sw",
        "xh" => "sw",
        "fa" => "fa",
        "km" => "vi",
        _ => "en-us",
    }
}

/// Find espeak-ng executable on the system.
fn find_espeak() -> Option<String> {
    // Try common locations
    let candidates = [
        "espeak-ng",
        r"C:\Program Files\eSpeak NG\espeak-ng.exe",
        "/usr/bin/espeak-ng",
        "/usr/local/bin/espeak-ng",
    ];

    for path in &candidates {
        if Command::new(path).arg("--version").output().is_ok() {
            return Some(path.to_string());
        }
    }
    None
}

/// Convert text to IPA phonemes using espeak-ng subprocess.
pub fn text_to_ipa(text: &str, lang: &str) -> Result<String, String> {
    let espeak = find_espeak().ok_or("espeak-ng not found on system")?;
    let voice = espeak_voice(lang);

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
    log::debug!("espeak-ng [{}]: '{}' → '{}'", voice, text, ipa);
    Ok(ipa)
}

/// Maps unsupported regional/exotic IPA characters to their closest Kokoro-supported equivalent.
/// This prevents syllable drops and terrible enunciation for languages
/// that Kokoro hasn't explicitly been trained on (e.g. Urdu, Arabic, etc).
fn fallback_ipa_char(c: char) -> Option<char> {
    match c {
        // --- Modifiers & Diacritics ---
        'ʱ' => Some('h'), // breathy voiced
        'ˤ' => None,      // pharyngealized - drop safely, preserve root consonant
        'ʼ' => None,      // ejective - drop safely
        'ʰ' => Some('h'), // aspirated
        
        // --- Vowels ---
        'ɞ' => Some('ə'), // open-mid central
        'ɨ' => Some('i'), // close central unrounded
        'ʉ' => Some('u'), // close central rounded
        'ɤ' => Some('o'), // close-mid back unrounded
        'ɯ' => Some('u'), // close back unrounded
        'ʏ' => Some('y'), // near-close near-front rounded
        'ɘ' => Some('e'), // close-mid central unrounded
        'ɵ' => Some('o'), // close-mid central rounded

        // --- Consonants ---
        'ɖ' => Some('d'), // retroflex d
        'ʈ' => Some('t'), // retroflex t
        'ɭ' => Some('l'), // retroflex l
        'ɳ' => Some('n'), // retroflex n
        'ʂ' => Some('s'), // retroflex s
        'ʐ' => Some('z'), // retroflex z
        'ɽ' => Some('r'), // retroflex r
        'ɟ' => Some('j'), // palatal stop
        'c' => Some('k'), // voiceless palatal stop
        'ɲ' => Some('n'), // palatal nasal
        'ɣ' => Some('g'), // voiced velar fricative
        'χ' => Some('k'), // voiceless uvular fricative
        'ʁ' => Some('r'), // voiced uvular fricative
        'q' => Some('k'), // voiceless uvular stop
        'ɢ' => Some('g'), // voiced uvular stop
        'ɴ' => Some('n'), // uvular nasal
        'ħ' => Some('h'), // voiceless pharyngeal fricative
        'ʕ' => Some('h'), // voiced pharyngeal fricative
        'ɓ' => Some('b'), // implosive b
        'ɗ' => Some('d'), // implosive d
        'ɠ' => Some('g'), // implosive g
        'ʄ' => Some('j'), // implosive j
        'ɾ' => Some('r'), // alveolar tap
        'ʀ' => Some('r'), // uvular trill
        'ʋ' => Some('v'), // labiodental approximant
        'ʍ' => Some('w'), // voiceless labiovelar fricative
        
        // --- Clicks and others (degrade aggressively) ---
        'ʘ' => Some('p'),
        'ǀ' => Some('t'),
        'ǃ' => Some('k'),
        'ǂ' => Some('k'),
        'ǁ' => Some('l'),

        _ => None,
    }
}

/// Convert text to Kokoro token IDs.
/// Pipeline: text → espeak-ng IPA → vocab lookup → token IDs.
pub fn text_to_tokens(text: &str, lang: &str) -> Result<Vec<i64>, String> {
    let ipa = text_to_ipa(text, lang)?;
    let v = vocab();

    // Start with padding token (0)
    let mut tokens: Vec<i64> = vec![0];

    for ch in ipa.chars() {
        if let Some(&id) = v.get(&ch) {
            tokens.push(id);
        } else if let Some(fb) = fallback_ipa_char(ch) {
            if let Some(&id) = v.get(&fb) {
                tokens.push(id);
            }
        }
        // else skip characters not in vocab and no fallback available
    }

    // End with padding token (0)
    tokens.push(0);

    if tokens.len() <= 2 {
        return Err("No valid phoneme tokens produced".to_string());
    }

    log::info!(
        "Phonemized: {} chars → {} IPA → {} tokens",
        text.len(),
        ipa.len(),
        tokens.len()
    );

    Ok(tokens)
}
