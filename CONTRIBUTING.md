# Contributing to HALT

Thank you for your interest in contributing to HALT. This project exists to save lives in places without internet, power, or connectivity — every contribution matters.

## Getting Started

1. **Fork** the repo and clone it locally
2. Run `pip install boto3` then `python dev/setup.py` to download models + runtime from R2
3. Run `start_on_Windows.bat` (Windows) or `./start_on_Mac.sh` (macOS)
4. The backend starts on `http://localhost:7778` with `--reload` — edit Python, save, see changes

## Project Structure

| Directory | What's There |
|---|---|
| `api/` | FastAPI backend (Python) |
| `viewer/` | Pre-built React frontend |
| `triage/` | Medical protocols, conditions, pharmacology (JSON) |
| `models/` | AI models — downloaded via `dev/setup.py` from R2 |
| `runtime/` | Portable Python 3.13 — downloaded via `dev/setup.py` |
| `dev/` | Build scripts, installers, setup, and deploy tooling |
| `electron/` | Desktop app shell |
| `assets/` | Branding and media |

## How to Contribute

### Reporting Issues
- Use GitHub Issues
- Include your OS, steps to reproduce, and expected vs actual behavior
- For medical data issues, tag with `clinical-safety`

### Submitting Code
1. Create a branch from `main`
2. Make your changes
3. Test locally with the dev launcher
4. Submit a Pull Request with a clear description

### Medical Data Contributions
If you're a medical professional and want to improve triage protocols, conditions, or pharmacology data:
- All medical data lives in `triage/` as JSON files
- Source scripts that generated this data are in `triage/_source/`
- Please cite your sources (clinical guidelines, publications, etc.)

## Important Notes

> **This is medical software.** Changes to triage protocols, drug dosages, or clinical logic require extra scrutiny. When in doubt, open an issue for discussion before submitting a PR.

> **Offline-first.** Every feature must work without an internet connection. Do not introduce cloud dependencies.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

*Built by [Hermetic Labs](https://hermeticlabs.app) for the people who run toward the worst moments in the world so the rest of us don't have to.*
