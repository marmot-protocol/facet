# Facet operations

## Local stack

`bun run dev:local` is the supported first-run path. It starts a pinned build of the IPF strfry
fork from `compose.local.yml`, mounts the same standalone policy artifact used in production, keeps
relay data in the `facet-local_facet-strfry-data` Docker volume, and runs Vite against
`ws://127.0.0.1:7777`. Kind 0 profile lookups use `wss://purplepag.es` and
`wss://indexer.coracle.social`; board events remain pinned to the local relay.

Use `bun run relay:local:reset` only when intentionally returning to an empty deployment; it removes
the local relay volume and cannot be undone. Override `FACET_STRFRY_REPOSITORY` and
`FACET_STRFRY_REF` when testing another reviewed strfry revision.

## strfry deployment

Facet v1 requires the local IPF strfry fork with NIP-42 enabled and its serial write-policy
plugin interface. The policy is infrastructure, not an application gateway, and keeps no database.

Configure strfry with:

```conf
relay {
    auth {
        enabled = true
        serviceUrl = "wss://relay.facet.ipf.dev"
    }
    writePolicy {
        plugin = "/absolute/path/to/facet-allowlist.js"
        timeoutSeconds = 10
    }
}
```

`deploy/facet-allowlist.js` is the standalone Node.js deployment artifact expected by strfry's
allowlist/write-policy slot. It contains the full Facet policy; it is not a static pubkey
whitelist. Rebuild it after policy or protocol changes with `bun run build:relay-policy`, copy it to
the relay host, and make it executable. The source-checkout wrapper at `deploy/facet-policy`
remains available for local development.

The policy process must receive:

- `FACET_STRFRY_BIN`: absolute path to the strfry binary used for startup replay.
- `FACET_STRFRY_DIR`: directory containing the deployment's `strfry.conf`.
- `FACET_TRUSTED_IMPORTER_PUBKEYS`: comma-separated historical importer keys. Keep these so
  accepted imported events remain valid during replay and in the frontend projection.
- `FACET_ACTIVE_IMPORTER_PUBKEYS`: the subset currently allowed to publish during a reviewed
  migration window. Set this to empty immediately after migration.
- `FACET_REQUIRE_NIP42=true`.
- `FACET_ALLOW_OTHER_EVENTS=false`.
- `FACET_MAX_CLOCK_SKEW_SECONDS=300`.

For the first verified-empty deployment only, `FACET_ALLOW_EMPTY_SEED=true` may replace the
strfry scan. Do not leave this set: restart replay must fail closed rather than reopen bootstrap.

The policy scans all Facet kinds on startup, validates deterministic replay, and exits if any
stored event would be invalid. strfry currently sends one policy request at a time, making the
first bootstrap atomic.

Authority and domain mutations are never deleted. Comment deletion uses ordinary NIP-09 semantics:
the signed kind 5 receipt targets the original comment and all of its edits, while carrying enough
structural tags to rebuild a content-free tombstone after strfry removes those targets. Keep kind 5
events in normal relay retention and backups. Reaction removal likewise retains its kind 5 request;
no strfry query or storage patch is required.

## Bootstrap and recovery

1. Start strfry and the static app.
2. Connect the intended super-admin signer. The first protected write obtains strfry's NIP-42
   challenge, authenticates, and retries automatically.
3. Bootstrap exactly once, then create the White Noise board.
4. Add at least one board admin before ordinary editing.

Super-admin rotation requires a kind 3499 event signed by the current super-admin. If that key is
lost, there is intentionally no UI bypass. Stop the deployment, create and verify a backup, and
start a fresh relay data directory before bootstrapping a replacement deployment. Retain the old
directory read-only for audit.

Back up the strfry data directory, configuration, deployed frontend commit, importer reports, and
source snapshot hashes together. Restore into a staging relay first and confirm policy replay before
directing production traffic to it.

## Frontend deployment

Set `VITE_FACET_RELAY_URL`, `VITE_FACET_PROFILE_RELAYS`, and the importer pubkey allowlist in
Vercel. Vite builds the CSP `connect-src` allowlist from the configured board and profile relay
environment variables, so changing relay deployment does not require editing source code. The
profile-relay default is `wss://purplepag.es,wss://indexer.coracle.social`.

The frontend is static. No signer account, bunker URI, private key, or application session is
persisted. A non-sensitive preference records when the user chose a NIP-07 browser extension, so
Facet can recreate that account from the installed extension after reload. Raw public Nostr events
use the Facet-specific `facet-events-v1` IndexedDB database; preferences, follows, inbox read markers,
and sync time use `facet-local`. Explicit disconnect removes the reconnect preference; “Clear local
data” deletes both stores and reloads the app. NIP-46 and Amber sessions remain memory-only.

## Migration

Inject `FACET_IMPORTER_KEY`, `OUTLINE_API_TOKEN`, and relay/Outline configuration from a secret
manager. Never put them in `.env` committed to the repository.

```sh
bun run import:outline -- \
  --export /secure/outline-export.zip \
  --board-id <board-id> \
  --relay wss://relay.facet.ipf.dev \
  --outline-url https://outline.example.com \
  --document-id <document-id>
```

This defaults to a dry run and writes event JSONL, the API snapshot, and reconciliation reports.
The dry run validates the complete projected board before any writes and reports expected, existing,
and pending event counts. Review both report formats, then rerun with `--publish`. A publish with
warnings is refused unless the operator explicitly acknowledges the reviewed warnings with
`--allow-warnings`. Existing imports are discovered in bounded stable-key batches, skipped safely,
and every expected key plus the final board projection is verified after publication. Clear
`FACET_ACTIVE_IMPORTER_PUBKEYS` immediately afterward, while retaining
the key in `FACET_TRUSTED_IMPORTER_PUBKEYS` and `VITE_FACET_IMPORTER_PUBKEYS` for historical
verification. Restart strfry and confirm replay succeeds before deleting the importer secret.

Flutter import requires a reviewed evidence mapping and verifies tag `v2026.5.22+25` resolves to
commit `2c16c5b0b384d52c660fbdea11922aceeb01ff74`:

```sh
bun run import:flutter -- \
  --repo /Users/jeff/code/whitenoise \
  --mapping /secure/flutter-evidence.json \
  --board-id <board-id> \
  --relay wss://relay.facet.ipf.dev
```

Only mappings backed by an existing path and optional exact source text receive a confirmed status.
Unproven mappings are refused and reported; the app displays missing cells as `unknown`.

## Direct verification

Before launch, connect with anonymous, unrelated authenticated, member, admin, and super-admin test
identities. Query kinds 3499–3506, 1111, 1009, 7, and 5 directly rather than through the app.
Anonymous reads must return all public data. Unrelated identities must be unable to publish. Confirm
private board mutations, final-admin removal, backdated authority events, removed-member edits, and
post-revocation importer writes all receive relay rejection.

The repository contains an opt-in disposable-relay test that checks the real strfry plugin
process, NIP-42 challenge, protected publish, anonymous reads, authorization, private-board
rejection, and restart replay:

```sh
FACET_TEST_STRFRY_BIN=/absolute/path/to/strfry \
FACET_TEST_STRFRY_SOURCE=/absolute/path/to/strfry-checkout \
bun run test:strfry
```
