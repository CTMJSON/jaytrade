# JayTrade

A paper-trading stock market simulator. Trade real, live-priced US equities with fake currency, track profit/loss, browse market movers and index trends, and set automated buy/sell triggers.

## Features

- Live search and quotes for real-world traded companies (via Finnhub)
- Portfolio tracking with real-time unrealized P/L
- Buy/sell trading against live market prices
- Scrolling market movers ticker (curated watchlist)
- 5-day index charts (Dow/Nasdaq/S&P/Russell, via ETF proxies)
- Analyst buy/hold/sell consensus per stock
- Automated trigger orders: buy when a price drops below a threshold, sell when it rises above (or drops below) one
- Trade history and one-click portfolio reset

## Stack

- **Backend**: Node.js + Express, SQLite (via the built-in `node:sqlite` module — no native build step required)
- **Frontend**: React + Vite, [recharts](https://recharts.org/) for charts
- **Market data**: [Finnhub](https://finnhub.io/) (quotes, search, analyst recommendations) and Yahoo Finance's public chart endpoint (index history)

## Local development

### Backend

```bash
cd server
cp .env.example .env   # then fill in your own Finnhub API key
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

## Production build

```bash
cd client && npm run build
```

The backend (`server/index.js`) serves the built `client/dist` directory as static files alongside the API, so a single Node process can serve the whole app — set `HOST=0.0.0.0` in `server/.env` to make it reachable on your LAN, then run `node index.js` (or set it up as a systemd/pm2 service for persistence).

A sample systemd unit is in [`deploy/stock-simulator.service`](deploy/stock-simulator.service) — replace the `<your-username>` placeholders and the `node` path with your own before installing it.

## Environment variables (`server/.env`)

| Variable | Description |
|---|---|
| `FINNHUB_API_KEY` | Required. Get a free key at [finnhub.io](https://finnhub.io/). |
| `PORT` | Port to listen on (default `3001`). |
| `HOST` | Interface to bind to (default `0.0.0.0`). |
| `STARTING_CASH` | Starting fake cash balance (default `100000`). |
| `ORDER_POLL_INTERVAL_MS` | How often automated trigger orders are checked (default `60000`). |

## Notes on data sources

- Finnhub's free tier caps at 60 requests/minute; the server caches quotes, search results, and the movers list to stay well under that.
- Yahoo Finance's chart endpoint is unofficial and unauthenticated — it works well but isn't a documented/stable API, so it could change without notice.
