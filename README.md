# SeeCost Tracker

`@seecost/tracker` is a lightweight server-side SDK and setup CLI for tracking LLM API usage cost.

It intercepts `fetch` calls to OpenAI, Anthropic, and Gemini endpoints, reads usage metadata from JSON responses, estimates request cost from model pricing, and sends the result to a SeeCost ingest endpoint asynchronously.

## Features

- Tracks OpenAI, Anthropic, and Gemini requests made through `fetch`
- Computes estimated USD cost from token usage
- Sends cost logs to SeeCost without blocking the app response
- Includes a small CLI to scaffold integration for Next.js, Express, Hono, and plain Node.js apps
- Supports re-initialization so tracker settings can be refreshed safely
- Can re-patch itself after `globalThis.fetch` has been replaced and initialized again

## Installation

Install from npm:

```bash
npm install @seecost/tracker
```

## Quick Start

Initialize the tracker once at the earliest server-side entry point in your app:

```ts
import { initSeeCostTrackerFromEnv } from "@seecost/tracker";

initSeeCostTrackerFromEnv();
```

Set the required environment variables:

```env
SEECOST_INGEST_ENDPOINT=https://seecost.watch/api/tracker/ingest
SEECOST_API_KEY=sc_xxxxxxxxxxxxxxxxxxxx
SEECOST_DEBUG=false
SEECOST_APP_NAME=my-app
```

`SEECOST_APP_NAME` is optional, but recommended if you want logs grouped by application inside SeeCost.

## What It Tracks

The tracker watches outgoing `fetch` requests to these providers:

- OpenAI
- Anthropic
- Google Gemini

For supported JSON responses, it extracts usage metadata, normalizes the model name, calculates estimated cost, and optionally forwards a log to SeeCost.

Non-target requests pass through untouched.

## How It Works

1. The SDK monkey-patches `globalThis.fetch`
2. Supported LLM API responses are cloned and parsed asynchronously
3. Token usage is converted to USD cost using bundled pricing rules
4. The app receives the original response immediately
5. A background ingest request is sent to SeeCost if configured

If the ingest request fails, the SDK suppresses the error so your app request is not affected.

## Manual Configuration

If you do not want to read from environment variables, initialize the tracker directly:

```ts
import { initSeeCostTracker } from "@seecost/tracker";

initSeeCostTracker({
  appName: process.env.SEECOST_APP_NAME,
  ingest: {
    endpoint: process.env.SEECOST_INGEST_ENDPOINT!,
    apiKey: process.env.SEECOST_API_KEY!,
  },
  debug: process.env.SEECOST_DEBUG === "true",
});
```

## CLI Setup

The package also ships a `seecost` CLI for bootstrapping integration code.

### Next.js

```bash
npx @seecost/tracker init nextjs
```

This will:

- append SeeCost env vars to `.env.local`
- create `instrumentation.ts` or `src/instrumentation.ts`
- register `initSeeCostTrackerFromEnv()` in the Node.js runtime only

If the project already has an instrumentation file, run:

```bash
npx @seecost/tracker init nextjs --force
```

### Express, Hono, and Node.js

```bash
npx @seecost/tracker init express
npx @seecost/tracker init hono
npx @seecost/tracker init node
```

This will:

- append SeeCost env vars to `.env`
- generate a bootstrap file
- inject the bootstrap import at the top of an existing server entry file

## Next.js Note for Linked Local Packages

If you install this package with a local `file:` dependency and the package source lives outside the Next.js project root, `next dev` with Turbopack may fail to resolve it even though `npm ls` shows it as installed.

Using the published npm package avoids that issue. If you must use a linked local dependency, configure Next.js so Turbopack can resolve the external package path.

## Operational Notes

- Use this on the server side only
- Do not expose `SEECOST_API_KEY` to the browser
- Initialize the tracker before your LLM client or any code that may replace `fetch`
- Re-run initialization if your runtime swaps out `globalThis.fetch` or if you refresh ingest settings
- Streaming responses are not tracked by the current implementation

## Supported Runtime Behavior

- Safe for repeated initialization
- Reconfiguration updates ingest target and app name
- Re-initialization can restore tracking after `fetch` has been replaced

## API

### `initSeeCostTracker(options?)`

Initializes the tracker with explicit options.

### `initSeeCostTrackerFromEnv(env?)`

Reads tracker config from environment variables and initializes the tracker.

### `getSeeCostOptionsFromEnv(env?)`

Parses environment variables and returns tracker options without initializing.

### `buildTrackerRuntimeConfig(options?)`

Builds the pricing and alias lookup tables used at runtime.

## Model Pricing and Aliases

Model pricing and alias mappings are bundled with the package:

- [`pricing.json`](./pricing.json)
- [`model-aliases.json`](./model-aliases.json)

Update those files if you need to add or adjust supported models.

## Development

```bash
npm install
npm test
```

Build output is written to `dist/`.

## License

MIT
