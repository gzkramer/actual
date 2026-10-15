# categorize-service

A small, stateless HTTP service that ranks a budget's categories for the
given transaction(s). It powers the experimental Smart Categorization
feature. The sync server proxies to it; browsers never call it directly.

## Endpoints

- `GET /health` returns `{ "status": "UP" }`.
- `GET /v1/info` returns the provider, model, max batch size and whether the
  provider is ready.
- `POST /v1/classify` takes `{ transactions, categories, currencySymbol? }` and
  returns ranked, validated suggestions per transaction id. See
  `src/contract.ts` for the full contract.

## Credentials

The service stores no credentials. `POST /v1/classify` needs an
`X-Claude-Token` header carrying a token from `claude setup-token`. The sync
server sends the token a server admin saved in the app (Settings > Experimental
features > Smart Categorization), and the service hands it to that one `claude`
run only. Keep the service on a private network: anyone who can reach it can
run Claude with their own token.

## Environment

| Variable | Default   | Purpose            |
| -------- | --------- | ------------------ |
| `PORT`   | `8080`    | Port to listen on. |
| `HOST`   | `0.0.0.0` | Interface to bind. |
