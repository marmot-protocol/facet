# Facet

Facet is a Nostr-native comparison and decision tracker. The first board tracks feature
parity across White Noise clients while keeping the underlying protocol generic enough for
future product-comparison boards.

The v1 application is public-board-only. It is a static React app that connects directly to a
configured strfry relay; a write-policy plugin enforces deployment and board authorization.
There is no application server or application database.

## Local development

Requirements: Bun 1.3.9 or newer and Docker Desktop/Engine with Compose.

```sh
bun install
bun run dev:local
```

This builds and starts the pinned strfry fork in Docker, mounts the real Facet write policy,
waits for NIP-42 relay health, and starts Vite at `http://127.0.0.1:5173`. Relay data persists in a
named Docker volume across runs. Press Ctrl-C to stop the app and relay.

An empty local relay opens the atomic deployment-bootstrap flow. Nothing is silently seeded or
published; White Noise subjects can be seeded explicitly from board administration, and the matrix
and discussion are populated by the migration tooling.

Useful relay-only jobs:

```sh
bun run relay:local:up
bun run relay:local:logs
bun run relay:local:down
bun run relay:local:reset # destructive: removes the local relay volume
```

To use an existing relay instead, copy `.env.example` to `.env.local`, set the Vite relay
variables, and run `bun run dev`.

## Verification

```sh
bun run typecheck
bun run lint
bun run test
bun run test:strfry # with FACET_TEST_STRFRY_BIN and FACET_TEST_STRFRY_SOURCE
bun run build
bun run test:e2e
```

Protocol and operator documentation lives in `docs/`.

## Deployment and migration

Facet's frontend is a static Vite build. Production writes require the bundled strfry policy and
NIP-42 authentication; the Outline and historical Flutter migrations are operator-run CLI tools
with dry-run reports, projection preflight, resumable stable-key publication, and post-publish
verification. See [`docs/operations.md`](docs/operations.md) for the deployment, bootstrap,
migration, backup, and verification runbook.

Source code is published at <https://github.com/marmot-protocol/facet>.

## License

Facet is licensed under the GNU Affero General Public License v3.0 or later.
