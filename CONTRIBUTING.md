# Contributing to HALT

Thank you for your interest in contributing to HALT. This project exists to save lives in places without internet, power, or connectivity — every contribution matters.

## Getting Started

1. **Fork** the repo and clone it locally
2. Run `pip install -r requirements.txt` to install Python dependencies
3. Run `python start.py` (works on Windows, macOS, and Linux)
4. AI models auto-download on first run (~4 GB one-time download)
5. The backend starts on `http://localhost:7778` with `--reload` — edit Python, save, see changes

## Project Structure

| Directory | What's There |
|---|---|
| `api/` | FastAPI backend (Python) |
| `viewer/` | React PWA — source in `src/`, built output in `dist/` |
| `triage/` | Medical protocols, conditions, pharmacology (JSON) |
| `models/` | AI models — downloaded via `dev/setup.py` from R2 |
| `runtime/` | Portable Python 3.13 — downloaded via `dev/setup.py` |
| `dev/` | Build scripts, installers, setup, and deploy tooling |
| `electron/` | Desktop app shell |
| `assets/` | Branding and media |

## How to Contribute

### Reporting Issues
- Use GitHub Issues — we have templates for [Bug Reports](.github/ISSUE_TEMPLATE/bug_report.md) and [Feature Requests](.github/ISSUE_TEMPLATE/feature_request.md)
- Include your OS, steps to reproduce, and expected vs actual behavior
- For medical data issues, tag with `clinical-safety`

### Submitting Code
1. Create a branch from `main`
2. Make your changes
3. Test locally with the dev launcher
4. Submit a Pull Request with a clear description

### Frontend (viewer/)

The full React source lives in `viewer/src/`. To work on it:

```bash
cd viewer
npm install          # install deps (Node 18+ required)
npm run dev          # dev server on :5173 — hot reload against backend on :7778
npm run build        # rebuild dist/ — commit the output alongside your source changes
npm run lint         # ESLint check
```

See [`viewer/README.md`](viewer/README.md) for full frontend development instructions. When submitting a frontend PR, include the rebuilt `viewer/dist/` so the backend can serve it immediately.

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

*Built by [Hermetic Labs](https://7hermeticlabs.com) for the people who run toward the worst moments in the world so the rest of us don't have to.*
