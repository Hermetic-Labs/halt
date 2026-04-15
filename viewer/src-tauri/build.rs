fn main() {
    #[cfg(target_env = "msvc")]
    {
        // /FORCE handles both duplicate ggml symbols (llama+whisper) and
        // the esaxx-rs CRT metadata mismatch (it hardcodes static_crt(true))
        println!("cargo:rustc-link-arg=/FORCE");
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:LIBCMT");
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcpmt");
    }
    tauri_build::build()
}
