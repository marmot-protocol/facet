import type { BoardProjection } from "@facet/protocol";

export function permissionsFor(projection: BoardProjection, pubkey?: string, online = true) {
  const membership = pubkey
    ? [...projection.memberships.values()].find(
        ({ value }) => value.pubkey === pubkey && value.state === "active",
      )?.value
    : undefined;
  const superAdmin = Boolean(pubkey && projection.superAdminPubkey === pubkey);
  return {
    superAdmin,
    membership,
    canWrite: online && Boolean(superAdmin || membership),
    canAdmin: online && Boolean(superAdmin || membership?.role === "admin"),
  };
}
