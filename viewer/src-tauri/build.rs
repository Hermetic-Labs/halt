fn main() {
    #[cfg(target_env = "msvc")]
    {
        // 32 MB stack — clip.cpp uses large on-stack tensor arrays during
        // vision model warmup that overflow the default 2 MB MSVC stack.
        println!("cargo:rustc-link-arg=/STACK:33554432");
    }
    tauri_build::build()
}
