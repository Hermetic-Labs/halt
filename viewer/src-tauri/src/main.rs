// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&String::from("--benchmark-llm")) {
        app_lib::benchmark_llm();
        return;
    }
    app_lib::run();
}
