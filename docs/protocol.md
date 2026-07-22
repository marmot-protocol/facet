# Facet v1 event protocol

Schema identifier: `facet.v1`

Facet derives shared state from immutable signed mutations. Cross-author entities do not use
Nostr replaceability because an addressable coordinate includes the author's pubkey. The client
and relay policy replay the same protocol package and resolve each logical entity by the greatest
`(created_at, event_id)` tuple.

## Kinds

| Kind | Name | Semantics |
|---:|---|---|
| 3499 | Deployment control | Bootstrap or super-admin rotation |
| 3500 | Board mutation | Create, update, archive, or restore a board |
| 3501 | Membership mutation | Add, remove, promote, or demote one pubkey |
| 3502 | Comparison-subject mutation | Active or historical comparison columns |
| 3503 | Feature-area mutation | The first and only grouping level |
| 3504 | Capability mutation | Capability, decisions, priority, rationale, links, and movement |
| 3505 | Assessment mutation | One capability × subject implementation status |
| 3506 | Thread-state mutation | Resolve or reopen a comment thread |
| 1111 | Comment | NIP-22 comment or one-level reply |
| 1009 | Comment edit | Same-author full replacement of one original kind 1111 event |
| 7 | Reaction | NIP-25 emoji reaction to a comment |
| 5 | Deletion request | Same-author comment tombstone or reaction removal |
| 22242 | Relay authentication | Ephemeral NIP-42 challenge response |

Kinds 3499–3506 and 1009 were unassigned in the official registry when checked on 2026-07-20.
They must be rechecked and registered before a public protocol release. A collision is handled by
one coordinated schema migration, never by accepting both meanings.

## Mutation envelope

```json
{
  "schema": "facet.v1",
  "operation": "create",
  "entityId": "stable-opaque-id",
  "baseEventId": null,
  "value": {}
}
```

`value` is the complete resulting entity, not a patch. Imported mutations add `importMetadata`
with source, stable source ID, and original attribution where applicable.

`baseEventId` is `null` for an initial mutation. Later mutations must point to a valid retained
event in that entity's history. A stale but real predecessor remains valid so confirmed concurrent
overwrites and their losing snapshots stay auditable; a nonexistent or cross-entity predecessor is
rejected. The client shows the intervening diff before publishing over a stale current version.

Every custom event has `t=facet`, `x=<entityId>`, and `o=<operation>`. Board events add `b`.
Feature, capability, subject, and assessment scopes use `f`, `c`, and `s`. Membership events add
`p` and `r`; prior versions use an `e` tag with marker `previous`. Import events add
`t=imported-outline` or `t=imported-flutter`. Every Facet write also carries the single-value
NIP-70 protected-event tag `["-"]`. This makes strfry issue the NIP-42 challenge before the serial
write policy runs; an unprotected Facet event is invalid even when its signature is otherwise
correct.

## Public-only v1

`visibility` remains `public | private` for forward compatibility, but every v1 writer and relay
policy rejects `private`. Current strfry has no authenticated board-aware read/subscription policy,
so the frontend never represents hiding a board as security. All accepted board data, history,
discussion, edits, and tombstones are anonymously readable.

## Authorization

- The first valid authenticated bootstrap establishes the deployment super-admin.
- Only that super-admin creates boards or rotates deployment control.
- Current admins or the super-admin manage membership and board metadata.
- The final active board admin cannot be removed or demoted.
- Current members edit ordinary active-board content.
- Historical locked subjects require an admin correction; their importer assessments are otherwise
  immutable.
- Removed members cannot edit or delete earlier comments.
- The configured importer pubkey is accepted only for source-marked migration operations.
- Outline importers may create subjects, areas, capabilities, and assessments; create imported
  comments/reactions; and publish the initial resolved state for imported threads. Flutter
  importers may only create the locked historical subject and its evidence-backed assessments.
- Authority events advance a per-scope high-water tuple, preventing a backdated role event from
  changing deterministic replay.

## Discussion

NIP-22 root/parent tags carry protocol references; `b`, `f`, `c`, optional `s`, stable `x` thread
ID, and `t=target:*` keep discussion attached to the logical capability across mutations. The UI
permits top-level comments and one reply level. If a capability moves between feature areas, old
threads retain their signed historical `f` scope while new threads use the current feature area.

Kind 1009 has exactly one `e` tag to the original comment, the same author, and complete replacement
content. The latest valid edit overlays the original while the comment exists.

A comment deletion is one signed kind 5 receipt that targets the original kind 1111 event and every
accepted kind 1009 edit. It also repeats the non-secret board, discussion, root/parent, and original
timestamp structure in tags. Normal strfry NIP-09 handling removes the targeted comment content and
edit history. The receipt remains queryable, so a freshly installed client can reconstruct a
content-free tombstone, keep surviving replies attached, and reject later replies without changing
strfry query semantics. A reaction deletion targets exactly the actor's prior kind 7 event. Kind 5
cannot target deployment, board, membership, or other domain mutations. Imported comments cannot be
edited or deleted after the importer key is revoked.

## IDs and ordering

- New entities and threads use UUIDv4.
- Imports, membership `(board,pubkey)`, and assessment `(board,capability,subject)` use documented
  UUIDv5 derivations from the namespace in `packages/protocol/src/constants.ts`.
- Ordered records use fractional-index strings so most reorders mutate only the moved entity.

Unknown fields and unknown major schemas are preserved in the raw event cache but rejected for
writes and excluded from projected state. New optional fields therefore require an explicit schema
revision rather than silently changing `facet.v1`.
