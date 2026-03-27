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

## Authentication
- Login is handled by a local Keycloak server.
- Default demo realm user: `admin / Admin123!`
- SvelteKit uses a server-side OIDC flow and an `HttpOnly` session cookie.

### App Auth Configuration

Copy the app env file if you want to override the defaults:

```bash
cp .env.example .env
```

Default local values:

- `APP_BASE_URL=http://localhost:5173`
- `KEYCLOAK_BASE_URL=http://localhost:8080`
- `KEYCLOAK_REALM=demo`
- `KEYCLOAK_CLIENT_ID=svelte-web`

## How to Run
Prerequisites:
- Node.js 18+

Commands:
1. `chmod +x setup.sh`
2. `./setup.sh`
3. `./start.sh`

The server should start at: `http://localhost:5173`
