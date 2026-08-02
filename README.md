# JayTrade

A paper-trading stock market simulator with a live, dark trading-terminal UI. Trade real, live-priced US equities with fake currency, get an analyst-style read on your portfolio, and set automated buy/sell triggers that execute on their own.

## Features

### Trading
- Live search and quotes for real-world traded companies
- **Symbol drawer** — clicking any ticker anywhere in the app (ticker strip, market list, holdings, movers tables, search) opens a slide-over with the quote, a timeframed chart, the 52-week range, analyst consensus, your existing position in that name, and the trade ticket
- Buy/sell trading priced against the live market at the moment of execution, with an inline confirmation step showing cost and remaining cash, and a toast receipt on fill
- Quick position sizing (25% / 50% / Max of buying power, or your whole position when selling)
- **⌘K command palette** — jump to any holding, search any ticker, or scroll to any section
- Full trade history

### Market data & discovery
- **Market Summary** — a symbol list plus a big interactive chart with selectable timeframes (1D / 1W / 1M / 3M / 1Y), a moving-average overlay, and a ticker search box
- **Markets (5-Day)** — index-tracking sparkline charts for the Dow, Nasdaq, S&P 500, and Russell 2000
- **Active Stocks** — paginated Biggest Gainers / Biggest Losers tables across a curated watchlist, with price, change, volume, relative volume, float, and market cap
- A scrolling movers ticker across the top of the app
- Per-stock analyst buy/hold/sell consensus

### Portfolio intelligence
The **Portfolio Value** chart plots your account's worth over time (1W / 1M / 3M / 1Y / all-time) with an optional S&P 500 overlay normalised to your starting value for the window — so "am I actually beating the market?" is answerable at a glance. The curve is reconstructed from your trade history against daily closes, so it has real depth the moment you open it rather than only accumulating going forward.

The **Portfolio Summary** panel reads like an analyst's take on your holdings, not just a numbers dump:
- Total value, cash, invested, all-time P/L, and today's move, each in dollars and percent
- Realized vs. unrealized P/L split — how much of your gain is actually locked in
- Today's best/worst mover and best/worst performer since purchase
- Win/loss count across open positions
- A visual allocation breakdown across every holding plus cash
- **Things to Know** — automatic flags for concentration risk (one position dominating the portfolio), cash sitting idle, and positions with no active stop-loss coverage
- **Suggested Actions** — a rules-based signal (Add / Hold / Trim / Review) per holding, combining analyst consensus, 5-day price trend, unrealized P/L, and position sizing, each with a plain-English reason. This is a transparent heuristic for a paper-trading simulator, not real investment advice, and is labeled as such in the UI.

### Automation
- Automated trigger orders: buy up to a set dollar amount when a price drops below a threshold, or sell a position when it drops below/rises above one
- A background poller checks active triggers and executes them automatically, whether or not anyone has the app open

## Design

A dark, pro-trading-terminal aesthetic: near-black panels, a custom candlestick-mark logo, monospace numerics (JetBrains Mono) for all prices and P/L, gradient-filled charts, and motion (panel fade-ins, hover states) instead of a static dashboard.

The page is ordered around the question a user actually arrives with — *how am I doing?* — so the portfolio comes first, market data second, automation and activity last, with a sticky header carrying live portfolio value and a sticky section nav. Prices flash green/red as they tick, gain/loss is carried by arrows as well as colour, every section has a loading skeleton and a visible retry rather than silently disappearing on upstream failure, and clickable table rows are keyboard reachable. Motion respects `prefers-reduced-motion`.

See [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) for the full design critique this structure came out of, including the backlog of what's still open.

## Stack

- **Backend**: Node.js + Express, SQLite via the built-in `node:sqlite` module (no native build step)
- **Frontend**: React + Vite, [Recharts](https://recharts.org/) for all charts
- **Market data**: [Finnhub](https://finnhub.io/) (quotes, search, company profiles, analyst recommendations) and Yahoo Finance's public chart endpoint (index and intraday history, volume)

### Reliability

Live third-party market data is inherently flaky, so the backend is built to absorb that instead of surfacing it to the user:

- A **background cache warmer** proactively refreshes movers, indices, and chart history on a schedule, so requests are served from a warm cache rather than triggering a live fetch
- **Stale-fallback caching** — if a refresh fails, the last good data is served instead of an error
- Request timeouts + retry-with-backoff on outbound calls, plus a concurrency gate on market-data requests to avoid overwhelming constrained hardware
- Finnhub's free tier caps at 60 requests/minute; quotes, search, and the movers list are cached to stay well under that

## Getting started

### Backend

```bash
cd server
cp .env.example .env   # fill in your own Finnhub API key
npm install
npm run dev
```

Runs on `http://localhost:3001` by default.

### Frontend

```bash
cd client
npm install
npm run dev
```

Runs on `http://localhost:5173` with a dev proxy to the backend API.

### Environment variables (`server/.env`)

| Variable | Description |
|---|---|
| `FINNHUB_API_KEY` | Required. Get a free key at [finnhub.io](https://finnhub.io/). |
| `PORT` | Port to listen on (default `3001`). |
| `HOST` | Interface to bind to (default `0.0.0.0`). |
| `STARTING_CASH` | Starting fake cash balance (default `100000`). |
| `ORDER_POLL_INTERVAL_MS` | How often automated trigger orders are checked (default `60000`). |
| `LANDING_HOST` | Optional. If set (e.g. `jaytrade.vip`), requests whose `Host` header matches this exactly get a static marketing page ([`server/landing/index.html`](server/landing/index.html)) instead of the app - useful for serving a landing page at an apex domain while the app itself lives on a subdomain. Unset by default, so every hostname just gets the app. |

## Deployment

```bash
cd client && npm run build
```

The backend (`server/index.js`) serves the built `client/dist` directory as static files alongside the API, so a single Node process serves the entire app. Set `HOST=0.0.0.0` to make it reachable on your LAN.

How well this app works depends a lot on *where* it's deployed, because several features rely on a long-running process:

### Always-on hosting (Raspberry Pi, home server, VPS)

This is the intended way to run JayTrade, and what it's tuned for. A persistent process means:

- The background cache warmer keeps market data continuously fresh, so the dashboard feels live even on a cold page load
- Automated trigger orders actually fire on their own — the poller checks prices and executes trades whether or not anyone has the app open
- SQLite writes straight to disk and just works — no extra setup

A sample systemd unit is in [`deploy/stock-simulator.service`](deploy/stock-simulator.service) — replace the `<your-username>` placeholders and the `node` binary path with your own, then:

```bash
sudo cp deploy/stock-simulator.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stock-simulator
```

This is exactly the setup this project runs on day to day: a Raspberry Pi on the local network, always on, with the app reachable at a friendly hostname over LAN DNS.

#### Remote access via Cloudflare Tunnel

To reach an always-on deployment from outside the local network without any port forwarding, [`deploy/cloudflared-tunnel.service`](deploy/cloudflared-tunnel.service) runs `cloudflared` pointed at `http://localhost:3001`, using a **named tunnel** tied to a domain in a (free) Cloudflare account — unlike an account-less Quick Tunnel, this gives a permanent URL that survives restarts and reboots.

One-time setup:

```bash
cloudflared tunnel login                          # opens a browser link to authorize against your Cloudflare account/domain
cloudflared tunnel create jaytrade                 # writes credentials to ~/.cloudflared/<tunnel-id>.json
cloudflared tunnel route dns jaytrade app.yourdomain.com   # creates the DNS record
```

Then point `~/.cloudflared/config.yml` at your tunnel and hostname:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<your-username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: app.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

Replace the `<your-username>` placeholders in [`deploy/cloudflared-tunnel.service`](deploy/cloudflared-tunnel.service), then:

```bash
sudo cp deploy/cloudflared-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-tunnel
```

The URL stays fixed across restarts since it's tied to the DNS record, not the tunnel process. (A free, account-less [Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) is a faster way to try things out with zero setup, but its `*.trycloudflare.com` URL is reassigned on every restart — not recommended once you're sharing the link with others.)

Each user gets their own name + PIN account (see below) with an isolated portfolio, so the tunnel URL alone doesn't expose anyone else's trades or holdings — but there's no invite/allowlist, so anyone with the link can register their own account.

### Ephemeral / serverless hosting (Vercel, Netlify Functions, AWS Lambda, etc.)

JayTrade will *run* on serverless platforms, but with real trade-offs, since there's no process alive between requests:

- **No background warmer** — every function invocation is its own short-lived process, so there's nothing to keep the cache warm in the background. Data gets fetched fresh (or from whatever cache survives a warm function instance) per request instead of proactively ahead of time. Expect slower, less consistent load times than the always-on setup.
- **Automated trigger orders won't fire on their own** — nothing is running continuously to poll prices, so a triggered order only executes if something external invokes the app (e.g. a scheduled function/cron hitting a dedicated endpoint). Out of the box, this feature is effectively inert on serverless.
- **SQLite needs a persistent volume** — most serverless filesystems are ephemeral or read-only, so `server/simulator.sqlite` won't reliably persist between invocations. You'd need to point it at a mounted volume or swap in a hosted database.

Serverless is a reasonable choice if you mainly want a live demo of the trading UI and live quotes, and don't need the automation or perfectly warm caches. For the full experience — automated triggers that actually run, and a dashboard that's always pre-warmed — run it as a persistent process instead.

## Notes on data sources

- Finnhub's free tier caps at 60 requests/minute and doesn't include trade volume — volume, relative volume, and moving averages are derived from Yahoo Finance's chart data instead.
- Yahoo Finance's chart endpoint is unofficial and unauthenticated. It's reliable in practice but isn't a documented/stable API, so it could change without notice.
