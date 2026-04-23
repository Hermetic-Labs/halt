//! AI model singletons — lazy-loaded inference engines.
//!
//! Each model is loaded once on first use and held in a global singleton.
//! This mirrors the Python pattern where models load lazily on first request.

pub mod kokoro;
pub mod llm;
pub mod llava;
pub mod nllb;
pub mod phonemizer;
pub mod phoneme_compiler;
pub mod whisper;

