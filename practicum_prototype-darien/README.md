# Practicum LEO Trajectory Prototype

# Dependencies
- Svelte 5 / SvelteKit
- Vite
- CesiumJS
- satellite.js
- TypeScript

- UI: Svelte 5 + SvelteKit routes for `/login` and `/dashboard`
- Visualization: CesiumJS viewer with updated satellite markers and a NASA texture

## Datasets Used
- NASA LEO TLE (Two Line Element)

## Authentication (Cyber Componet)
- Default credentials: `admin / admin`
- Security: client-side only, using a `localStorage` token.

## How to Run
Prerequisites:
- Node.js 18+

Commands:
1. `chmod +x setup.sh`
2. `./setup.sh`
3. `./start.sh`

The server should start at: `http://localhost:5173`
