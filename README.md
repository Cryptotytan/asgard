# Asgard

NEAR terminal. Swap, spot, vault, and lend settle through NEAR Intents 1-Click from a connected NEAR wallet.

## Deploy on Vercel

1. Import this repository in [Vercel](https://vercel.com/new).
2. Framework preset: **Other**. The build writes `.vercel/output` (Nitro, Vercel preset).
3. Build command: `npm run build`. Install command: `npm install`.
4. Leave Output Directory empty.
5. Do not set `DATABASE_URL` unless you attach Postgres. Without it, the app uses its local fallback and skips migrations.
6. Deploy. Open `/` for the homepage and `/app` for the terminal.

Node 22 is enough. `@tanstack/react-start` is pinned at 1.168.60 or newer so Vercel will accept the build.
