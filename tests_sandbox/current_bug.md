# Current Bug: CI/CD Windows Compiler Linkage Loop

## Goal
To stabilize the HALT triage system's CI/CD pipeline on GitHub Actions, decoupled from the legacy monolithic layout into independent Desktop and iOS tracks. The specific immediate objective was to get the Windows Native Pipeline to successfully compile and package the application payload via Tauri using Microsoft's underlying C++ and Rust toolchains.

## What We Tried & Historical Blockers

### 1. Initial Block at MSVC `cdylib` Linkage
- The first Windows build (`24624851544`) predictably failed at the linker phase when compiling `app_lib.dll`. It threw a massive block of `LNK2001: unresolved external symbol _tls_used` and `/GUARD:CF` control-flow collision panics.
- **The Intervention:** I identified that `cdylib` inside the main `Cargo.toml` was forcing the MSVC compiler into an unmanaged CFG breakdown. I deleted `cdylib` and stripped the original pipeline's hardcoded `/MT` environment variables, theoretically letting the system fall back to its native dynamic (`/MD`) bindings.

### 2. The LLVM/Clang Ninja Pivot & The 18-minute Collapse
- When I stripped the `/MT` environment overrides from the runner, I also accidentally removed `CMAKE_GENERATOR=Visual Studio 17 2022`.
- Without a mandated Generator, GitHub Actions automatically fell back to the `Ninja` build system, which natively detected the LLVM/Clang compiler running quietly in the background memory.
- The runner spent 18 minutes compiling C++ libraries using Clang-flavored `.obj` structural matrices. But when Microsoft's proprietary `link.exe` attempted to ingest those Clang-generated objects, it completely imploded—generating errors like `LNK2019: unresolved external symbol __favor` and `_GSHandlerCheck_SEH`. These are pure Microsoft-specific runtime optimizations that Clang inherently does not define.

### 3. The `/MT` `+crt-static` Ghost Chase
- Believing the missing headers implied a Static C-Runtime mismatch, I forcefully injected `-C target-feature=+crt-static` into the Windows environment. This caused the Rust compiler to physically reject the pipeline syntax over a hardcoded `/GUARD:NO` error.
- We stripped the CLI syntax, corrected it to standard `+crt-static`, and explicitly hydrated the `CMAKE_GENERATOR` to guarantee `cl.exe` (Microsoft compiler) would handle the actual execution.
- **The Final Break:** The runner ran flawlessly up until the 17-minute mark again, compiling the main `halt-triage.exe` entirely successfully, before violently failing on the absolute last step—linking `halt_nllb.exe` (The NLLB sidecar) with identical `__guard_dispatch_icall_fptr` unresolvable references.

## The Absolute Truth & Current Thinking

The final realization hit exactly when comparing the original, working monolithic pipeline configuration to the configuration I generated.

### 1. The Vendored Logic (`/MD`)
The `vendor/ct2rs/build.rs` pipeline is brutally localized and explicitly hardcoded to compile CTranslate2 using `"CMAKE_MSVC_RUNTIME_LIBRARY"` = `"MultiThreadedDLL"` (`/MD`) because the `ort-sys` (ONNX Runtime) explicitly mandates dynamic allocation. Therefore, enforcing `/MT` via static environments was physically colliding with the intentional architecture. It must remain dynamic.

### 2. The Sidecar Loophole
More importantly, the critical realization was that **Windows was never supposed to compile the NLLB sidecar sequentially inside the main pipeline.** 

When macOS crashed early today because it was missing the `halt_whisper` and `halt_nllb` bundles, I globally forced `--features "native_ml,whisper_stt,nllb_translate"` onto the `tauri build` execution payload natively across *all platforms*, including Windows.

The `Cargo.toml` explicitly identifies `nllb_translate` as: 
*"Standalone NLLB binary — separate process to avoid CTranslate2 CRT crashes."*

By forcefully injecting all features onto the GitHub Windows Runner, I demanded it compile a binary that is structurally known to collapse the MSVC CRT linkage tables natively on Windows. Because of this, it chased a completely unfixable C++ compiler limitation for hours.

## The Ultimate Fix
Everything currently configured in `release-desktop.yml` is essentially correct—we just need to surgically delete the artificial `--features "native_ml,whisper_stt,nllb_translate"` argument block from the Windows runner job, allowing it to bypass the NLLB CRT linker trap and successfully package the main application, exactly as it was originally designed.
