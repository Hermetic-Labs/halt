//! Phonological Rules Engine and Mapping Layer
//! Serves as an invariant safety bridge mapping 42 dialects to the absolute 178 Kokoro bounds.

use std::collections::HashSet;
use std::sync::OnceLock;

/// Exposes the strictly bounded Kokoro phonological map logic.
pub fn compile(ipa: &str, lang: &str) -> String {
    let tokens = tokenize_ipa(ipa);
    let mut mapped = apply_universal_rules(tokens);
    mapped = apply_family_rules(mapped, lang);
    let safe = kokoro_filter(&mapped);
    safe.into_iter().collect::<String>()
}

fn tokenize_ipa(ipa: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = ipa.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // Priority 1: 3-char sequences (e.g., t͡ɕ)
        if i + 2 < chars.len() {
            let seq: String = chars[i..=i+2].iter().collect();
            if match_multi_char(&seq) {
                tokens.push(seq);
                i += 3;
                continue;
            }
        }
        // Priority 2: 2-char sequences (e.g., dʒ, tʃ, dʑ, iː, ã)
        if i + 1 < chars.len() {
            let seq: String = chars[i..=i+1].iter().collect();
            if match_multi_char(&seq) || chars[i+1] == '\u{0303}' || chars[i+1] == 'ː' || chars[i+1] == 'ʰ' {
                tokens.push(seq);
                i += 2;
                continue;
            }
        }
        
        tokens.push(chars[i].to_string());
        i += 1;
    }
    tokens
}

fn match_multi_char(seq: &str) -> bool {
    matches!(
        seq,
        "t͡ɕ" | "d͡ʑ" | "t͡ʃ" | "d͡ʒ" | "dʒ" | "tʃ" | "ts" | "dz" | "tɕ" | "dʑ" | "tʰ" | "kʰ" | "pʰ" | "t͡s" | "d͡z"
    )
}

fn apply_universal_rules(tokens: Vec<String>) -> Vec<String> {
    tokens.into_iter().map(|token| {
        match token.as_str() {
            // Map non-vocab characters to their closest vocab equivalents.
            // Characters that ARE in the Kokoro vocab pass through untouched.

            // Pharyngeal (not in vocab)
            "ʕ" => "ʔ".to_string(),
            "ħ" => "h".to_string(),

            // Non-vocab sibilants
            "ʐ" => "ʒ".to_string(),
            "ʑ" => "ʒ".to_string(),
            "ɭ" => "l".to_string(),

            // Implosives (not in vocab)
            "ɓ" => "b".to_string(),
            "ɗ" => "d".to_string(),
            "ʄ" => "j".to_string(),
            "ɠ" => "ɡ".to_string(),

            // Affricates: multi-char sequences to single-char Kokoro tokens
            "dʒ" | "d͡ʒ" => "ʤ".to_string(),
            "tʃ" | "t͡ʃ" => "ʧ".to_string(),
            "ts" | "t͡s" => "ʦ".to_string(),
            "dz" | "d͡z" => "ʣ".to_string(),
            "tɕ" | "t͡ɕ" => "ʨ".to_string(),
            "dʑ" | "d͡ʑ" => "ʥ".to_string(),

            // ASCII g not in vocab; IPA ɡ (U+0261) is
            "g" => "ɡ".to_string(),

            // Drop clicks (not in vocab)
            "ʘ" | "ǀ" | "ǁ" | "ǃ" | "ǂ" => "".to_string(),

            _ => {
                // Strip only non-vocab combining diacritics.
                // \u{0303}, ː, ʰ ARE valid Kokoro tokens — do NOT strip them.
                let cleaned: String = token.chars().filter(|c| {
                    !matches!(*c, 'ˤ' | '\u{0302}' | '\u{030C}' | '\u{0304}')
                }).collect();
                cleaned
            }
        }
    }).collect()
}

fn apply_family_rules(tokens: Vec<String>, lang: &str) -> Vec<String> {
    tokens.into_iter().map(|token| {
        match lang {
            // Indo-Aryan / Eastern Iranian (Pashto, Urdu, Hindi)
            // Characterized by retroflex consonants and tapped Rs
            "ps" | "ur" | "hi" | "bn" | "ta" | "te" | "mr" => match token.as_str() {
                "ɹ" | "r" => "ɾ".to_string(),
                "t" => "ʈ".to_string(),
                "d" => "ɖ".to_string(),
                "æ" | "ʌ" => "a".to_string(),
                _ => token
            },
            // Semitic / Western Iranian (Arabic, Persian, Kurdish)
            // Lacks retroflex, but still uses tapped Rs and harder vowels
            "ar" | "fa" | "ku" | "he" => match token.as_str() {
                "ɹ" | "r" => "ɾ".to_string(),
                "æ" | "ʌ" => "a".to_string(),
                "v" => "f".to_string(), // Arabic lacks v
                _ => token
            },
            // Afro-Asiatic / Sub-Saharan (Somali, Hausa, Amharic)
            // Tapped Rs, flat vowels, some lack 'p' or 'v'
            "so" | "ha" | "am" | "sw" => match token.as_str() {
                "ɹ" | "r" => "ɾ".to_string(),
                "æ" | "ʌ" => "a".to_string(),
                "p" => "b".to_string(), // Somali lacks p
                "v" => "f".to_string(), // Somali/Hausa often lack v
                "z" => "s".to_string(), // Somali lacks z
                _ => token
            },
            _ => token
        }
    }).collect()
}

fn kokoro_vocab_set() -> &'static HashSet<char> {
    static VOCAB: OnceLock<HashSet<char>> = OnceLock::new();
    VOCAB.get_or_init(|| {
        // Deterministic: derived directly from the phonemizer vocab HashMap.
        // Single source of truth — no manual string duplication.
        let mut set: HashSet<char> = super::phonemizer::vocab().keys().copied().collect();
        set.insert('-'); // hyphen used as silence marker
        set
    })
}

fn kokoro_filter(tokens: &[String]) -> Vec<String> {
    let vocab = kokoro_vocab_set();
    tokens.iter()
          .map(|tok| {
              // Final absolute boundary constraint loop.
              // Strip out any characters explicitly missing from the Kokoro dictionary.
              let safe_tok: String = tok.chars().filter(|c| c.is_whitespace() || vocab.contains(c)).collect();
              safe_tok
          })
          .filter(|t| !t.is_empty())
          .collect()
}
