# Keycloak Local Auth Server

This folder runs a local Keycloak server next to the SvelteKit app so the demo can keep the web app and the auth server separated.

## What It Starts

- Keycloak on `http://localhost:8080`
- PostgreSQL for Keycloak on `localhost:5433`
- A demo realm named `demo`
- A demo OIDC client named `svelte-web`
- A demo user:
  - username: `admin`
  - password: `Admin123!`
- A custom login theme named `leo`

## First Run

1. Copy the env file:

```bash
cp .env.example .env
```

2. Start the stack:

```bash
docker compose up -d
```

If you changed the realm import or theme files and want Keycloak to reload them cleanly:

```bash
docker compose down -v
docker compose up -d
```

3. Open the admin console:

- URL: `http://localhost:8080/admin`
- admin username: value of `KEYCLOAK_ADMIN`
- admin password: value of `KEYCLOAK_ADMIN_PASSWORD`

## Realm Details

- Realm: `demo`
- Issuer URL: `http://localhost:8080/realms/demo`
- Account console: `http://localhost:8080/realms/demo/account`

## Svelte App Integration Target

The imported client is already configured for your local Svelte app:

- Client ID: `svelte-web`
- Redirect URI: `http://localhost:5173/*`

When you wire the frontend later, use standard OIDC Authorization Code flow with PKCE.

## MFA

The realm import enables OTP/TOTP support. For a quick demo, you can require MFA for a user like this:

1. Log into the Keycloak admin console.
2. Open the `demo` realm.
3. Open `Users`.
4. Select the user.
5. Add the required action `Configure OTP`.

On next login, Keycloak will prompt that user to enroll an authenticator app.

## Stop And Reset

Stop services:

```bash
docker compose down
```

Stop and remove database data:

```bash
docker compose down -v
```
