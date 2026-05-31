# LPManager — Meteora

Gestor de liquidez para **Meteora** en Solana, desde una sola UI:

- **DLMM** (liquidez concentrada por bins): buscar/crear pools, elegir estrategia según
  condición de mercado (bearish / consolidación / bullish), configurar el rango de bins y
  abrir la posición. Soporta modos *single-SOL (bid)*, *single-token (ask)* y *bilateral*,
  con auto-swap del déficit de token vía Jupiter.
- **DAMM v2** (CP-AMM): crear pools de producto constante con fee scheduler (fijo / time /
  market-cap), dynamic fee y posición NFT.

Las transacciones se firman **server-side** con una hot wallet y se mandan vía Helius
(smart TX: simulación de compute units + priority fee + `rebate-address` para capturar MEV).

> ⚠️ **Mueve fondos reales.** Usá una wallet dedicada con saldo acotado, nunca la principal.
> Si lo deployás, seteá `API_SECRET` (ver abajo) — sin eso las rutas que firman quedan abiertas.

## Stack

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind v4 · `@solana/web3.js` ·
`@meteora-ag/dlmm` · `@meteora-ag/cp-amm-sdk` · Jupiter · Helius.

## Setup

1. Instalar deps: `npm install`
2. Copiar `.env.local.example` a `.env.local` y completar:
   - `HELIUS_API_KEY` — RPC + DAS API ([dashboard.helius.dev](https://dashboard.helius.dev/))
   - `JUPITER_API_KEY` — precios y swaps ([portal.jup.ag](https://portal.jup.ag/))
   - `WALLET_PRIVATE_KEY` — hot wallet que firma (JSON array de la CLI o base58 de Phantom)
   - `NEXT_PUBLIC_WALLET_ADDRESS` — pubkey para mostrar en la UI
   - `API_SECRET` — *(opcional, recomendado si deployás)* protege las rutas que firman
   - `NEXT_PUBLIC_SOLANA_CLUSTER` — *(opcional)* `devnet` habilita `/api/airdrop`
3. Dev: `npm run dev` → http://localhost:3000

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (corre el type-check) |
| `npm run start` | Sirve el build |
| `npm run smoke:devnet` | Smoke test contra el dev server (ver abajo) |

## Smoke test (devnet)

Valida el wiring devnet sin mover fondos reales: conexión RPC cluster-aware, carga de la
wallet, balance on-chain, precio y faucet.

1. En `.env.local`: `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`
2. Terminal A: `npm run dev`
3. Terminal B: `npm run smoke:devnet` — o con faucet: `npm run smoke:devnet -- --airdrop`

Opcionales: `SMOKE_TOKEN_MINT=<mint>` prueba `/api/token`; `SMOKE_BASE_URL` cambia el host.
No cubre crear pool / abrir posición / swap: esas usan APIs hosteadas de Meteora/Jupiter que
son mainnet-only, así que se prueban en mainnet con montos chicos.

## Rutas API

Lectura: `GET /api/token`, `/api/price`, `/api/pool`, `/api/pool/info`, `/api/balance`,
`/api/swap/quote`.
Firman/mueven fondos (protegidas por `middleware.ts` cuando hay `API_SECRET`):
`POST /api/swap/execute`, `/api/position/open`, `/api/pool/create`, `/api/damm/create`,
`/api/airdrop` *(solo devnet)*.

## Wallet Tracker (`/tracker`)

Detecta grupos coordinados en pump.fun por **co-ocurrencia**: analizás varios tokens (por CA),
baja las primeras N compras de cada uno (on-chain vía **Helius**, bonding-curve PDA) y rankea las
wallets que reaparecen temprano en varios. Las de ubicuidad altísima se etiquetan 🤖 (bot/sniper) vs
🟢 (grupo). Después podés **monitorear** ese set con un webhook de Helius y recibir alertas cuando
compran un token nuevo. El **discover** (tokens trending) usa Jupiter (gratis). Sin indexer pago.

Es **local-first**: corre en tu PC con SQLite (`data/tracker.db`, gitignoreado). Las alertas en vivo
solo llegan con la PC y el túnel prendidos.

**Setup:**
1. `.env.local`: `HELIUS_API_KEY` (early buyers + realtime), `TRACKER_WEBHOOK_SECRET` (string random largo),
   `TRACKER_PUBLIC_URL`. El discover (Jupiter) no necesita key.
2. `npm run dev`.
3. Para el realtime, levantá un túnel y poné su URL en `TRACKER_PUBLIC_URL`:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   (sin barra final, sin `/api/...`). Reiniciá el dev server para tomar la env var y dale "Monitorear".

**Flujo:** abrir `/tracker` → pegar CAs y "Analizar" (varios) → ajustar umbral → "Monitorear el grupo"
→ ver alertas en vivo. Crear pool/abrir LP siguen en el LP Manager (`/`).

**Descubrir** (tab en `/tracker`): modos **"Top 24h" · "Trending" · "Recién creadas"** traen las memes
de pump.fun más activas vía **Jupiter Token API V2** (gratis, sin API key), con
`ticker · vol 24h · mcap · holders · organic score · dev`. Tildás las que te interesan y "Agregar a
análisis" las manda al flujo de co-ocurrencia. (Jupiter da ventanas móviles, no días históricos.)

**Test de integración (local):** `npm run test:discover` trae el top de pump.fun (Jupiter) y corre el
analyze (early buyers vía Helius) sobre los primeros, verificando el pipeline contra datos reales.
Corre **solo local** (Helius usa quota) y se engancha como **git hook de pre-push** — antes de cada
`git push` se ejecuta solo. El hook (`.githooks/pre-push`) se activa con `npm install` (postinstall
setea `core.hooksPath`); si no hay `HELIUS_API_KEY`, se saltea. Forzar push sin correrlo: `git push --no-verify`.
