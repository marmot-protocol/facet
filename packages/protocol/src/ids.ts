import { generateKeyBetween } from "fractional-indexing";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { FACET_UUID_NAMESPACE } from "./constants";

export function newEntityId(): string {
  return uuidv4();
}

export function importedEntityId(source: string, sourceId: string): string {
  return uuidv5(`import:${source}:${sourceId}`, FACET_UUID_NAMESPACE);
}

export function membershipId(boardId: string, pubkey: string): string {
  return uuidv5(`membership:${boardId}:${pubkey.toLowerCase()}`, FACET_UUID_NAMESPACE);
}

export function assessmentId(boardId: string, capabilityId: string, subjectId: string): string {
  return uuidv5(`assessment:${boardId}:${capabilityId}:${subjectId}`, FACET_UUID_NAMESPACE);
}

export function importedThreadId(sourceId: string): string {
  return uuidv5(`thread:outline:${sourceId}`, FACET_UUID_NAMESPACE);
}

export function orderKeyBetween(before?: string | null, after?: string | null): string {
  return generateKeyBetween(before ?? null, after ?? null);
}
