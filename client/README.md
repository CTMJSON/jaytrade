# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Live quotes (WebSocket)

The server streams live quotes over Finnhub's WebSocket and re-publishes them to the
browser via Server-Sent Events at `/api/quotes/stream?symbols=AAPL,MSFT,...`.

- `FINNHUB_API_KEY` (required) — already needed for REST quotes/profiles; it now also
  authenticates the WebSocket connection (`wss://ws.finnhub.io?token=...`) in
  `server/live-quotes.js`.
- `/api/quotes/stream` is SSE: the `symbols` query param is a comma-separated list of
  tickers. The client's `store/useLiveQuote` hook opens one connection and merges pushed
  prices over the REST-rendered rows.
- Symbol budget: total WebSocket subscriptions are capped at **50** across the whole app
  (Finnhub free tier limit — see the `MAX_WS_SYMBOLS` comment in `server/live-quotes.js`).
  The stream ignores subscription requests beyond the cap.
