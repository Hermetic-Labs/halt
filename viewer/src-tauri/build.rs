fn main() {
    #[cfg(target_env = "msvc")]
    {
        // /FORCE handles both duplicate ggml symbols (llama+whisper) and
        // the esaxx-rs CRT metadata mismatch (it hardcodes static_crt(true))
        // println!("cargo:rustc-link-arg=/FORCE");
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:LIBCMT");
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcpmt");
        // 32 MB stack — clip.cpp uses large on-stack tensor arrays during
        // vision model warmup that overflow the default 2 MB MSVC stack.
        println!("cargo:rustc-link-arg=/STACK:33554432");
    }
    tauri_build::build()
}
