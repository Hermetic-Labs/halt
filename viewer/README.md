# HALT — Viewer (Frontend)

This directory contains the pre-built React PWA served by the FastAPI backend.

## For end users and backend contributors

You do not need to touch this directory. The backend at `api/` serves `viewer/dist/` automatically on `http://localhost:7778`. Just run:

```bash
python start.py
```

## For frontend contributors

The viewer is a React 19 + TypeScript + Vite PWA. To modify it:

**Prerequisites:** Node.js 18+

```bash
cd viewer
npm install
npm run dev       # Dev server on :5173 (hot reload, talks to backend on :7778)
npm run build     # Rebuild dist/ (commit the output)
npm run lint      # ESLint check
```

> After building, commit the updated `viewer/dist/` so the backend can serve the new version.

## Stack

| Layer | Tool |
|-------|------|
| Framework | React 19 |
| Language | TypeScript 5 |
| Build | Vite 7 |
| PWA | vite-plugin-pwa (Workbox) |
| Charts | Recharts |
| Fonts | Inter, JetBrains Mono |

## Architecture

The frontend is a single-page app with client-side routing. All state is local to the session — no Redux, no global store. The backend is the source of truth; the frontend polls or subscribes via WebSocket.

Key entry points:
- `src/App.tsx` — tab layout, routing, settings panel
- `src/hooks/` — API calls, WebSocket subscriptions, AI inference
- `src/components/` — feature panels (patients, comms, ward, inventory, etc.)
- `src/i18n/` — translation system (34 languages, fully offline)
