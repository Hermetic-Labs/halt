# Security Policy

## Scope

HALT is medical triage software designed for air-gapped, offline environments. Security is critical — not because of network attack surfaces, but because **clinical decisions depend on the integrity of this data**.

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Current |

## Reporting a Vulnerability

If you discover a security issue, **please report it responsibly**:

1. **Email**: security@hermeticlabs.app
2. **Do NOT** open a public GitHub issue for security vulnerabilities
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)

We will acknowledge your report within 48 hours and provide a timeline for resolution.

## Security Model

### Data at Rest
- Patient data is stored locally in `patients/` with AES-256 encryption
- Encryption keys are generated per-installation and never transmitted
- Patient data is `.gitignored` and never committed to version control

### Network
- HALT is designed to run **completely offline**
- No telemetry, no phone-home, no cloud dependencies
- When network is available, it is only used for:
  - Downloading updates from Cloudflare R2
  - Transferring builds between devices on local networks

### AI Models
- All inference runs locally on-device
- Models are bundled with the distribution — no external API calls
- No patient data ever leaves the device

### Clinical Safety
- Triage protocols are sourced from published medical guidelines
- Drug dosage data should be verified against institutional formularies
- HALT is a **decision support tool**, not a replacement for clinical judgment

## Responsible Disclosure

We follow a 90-day disclosure timeline:
1. Report received → acknowledged within 48 hours
2. Fix developed → within 30 days for critical issues
3. Patch released → coordinated with reporter
4. Public disclosure → 90 days after initial report, or upon patch release (whichever is sooner)
