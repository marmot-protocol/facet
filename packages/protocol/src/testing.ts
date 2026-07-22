import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools";
import { createMutationFactory, type MutationFactoryInput, type MutationValue } from "./events";

export type TestIdentity = {
  secretKey: Uint8Array;
  pubkey: string;
};

export function createTestIdentity(): TestIdentity {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey) };
}

export function signTemplate(
  identity: TestIdentity,
  template: { kind: number; created_at: number; content: string; tags: string[][] },
): NostrEvent {
  return finalizeEvent(template, identity.secretKey);
}

export async function signMutation<T extends MutationValue>(
  identity: TestIdentity,
  input: MutationFactoryInput<T>,
): Promise<NostrEvent> {
  const template = await createMutationFactory(input);
  return signTemplate(identity, template);
}
