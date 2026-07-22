import { z } from "zod";
import { FACET_SCHEMA } from "./constants";

export const entityStateSchema = z.enum(["active", "archived"]);
export const subjectStateSchema = z.enum(["active", "historical", "archived"]);
export const visibilitySchema = z.enum(["public", "private"]);
export const boardRoleSchema = z.enum(["member", "admin"]);
export const membershipStateSchema = z.enum(["active", "removed"]);
export const implementationStatusSchema = z.enum([
  "unknown",
  "not_implemented",
  "partial",
  "implemented",
  "stub_or_broken",
  "not_applicable",
]);
export const desiredOutcomeSchema = z.enum([
  "keep_as_is",
  "add",
  "remove",
  "standardize",
  "platform_specific",
  "undecided",
]);
export const decisionStatusSchema = z.enum(["open", "discussing", "decided", "superseded"]);
export const prioritySchema = z.enum(["now", "next", "later", "none"]);
export const threadStateSchema = z.enum(["open", "resolved"]);

const idSchema = z.string().min(1).max(200);
const orderKeySchema = z.string().min(1).max(100);
const pubkeySchema = z.string().regex(/^[0-9a-f]{64}$/i);

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.url().max(2048),
});

export const boardSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().max(10_000).optional(),
    visibility: visibilitySchema,
    state: entityStateSchema,
  })
  .strict();

export const membershipSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    pubkey: pubkeySchema,
    role: boardRoleSchema,
    state: membershipStateSchema,
  })
  .strict();

export const subjectSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(5000).optional(),
    icon: z.string().max(500).optional(),
    orderKey: orderKeySchema,
    state: subjectStateSchema,
    includeInGapAnalysis: z.boolean(),
    locked: z.boolean(),
  })
  .strict();

export const featureAreaSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).optional(),
    orderKey: orderKeySchema,
    state: entityStateSchema,
  })
  .strict();

export const capabilitySchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    featureAreaId: idSchema,
    title: z.string().trim().min(1).max(240),
    description: z.string().max(20_000).optional(),
    orderKey: orderKeySchema,
    state: entityStateSchema,
    desiredOutcome: desiredOutcomeSchema,
    decisionStatus: decisionStatusSchema,
    priority: prioritySchema,
    rationaleCommentId: idSchema.optional(),
    links: z.array(linkSchema).max(50),
  })
  .strict();

export const assessmentSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    featureAreaId: idSchema,
    capabilityId: idSchema,
    subjectId: idSchema,
    status: implementationStatusSchema,
    note: z.string().max(10_000).optional(),
    state: entityStateSchema,
  })
  .strict();

export const threadStateValueSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    capabilityId: idSchema,
    rootCommentId: z.string().regex(/^[0-9a-f]{64}$/i),
    state: threadStateSchema,
  })
  .strict();

export const deploymentControlSchema = z
  .object({
    superAdminPubkey: pubkeySchema,
  })
  .strict();

export const importMetadataSchema = z
  .object({
    source: z.enum(["outline", "flutter"]),
    sourceId: z.string().min(1).max(500),
    originalAuthorName: z.string().max(500).optional(),
    originalCreatedAt: z.iso.datetime().optional(),
    originalParentId: z.string().max(500).optional(),
    flattenedFromDepth: z.number().int().nonnegative().optional(),
    attachmentOmitted: z.boolean().optional(),
  })
  .strict();

export const mutationOperationSchema = z.enum([
  "bootstrap",
  "rotate",
  "create",
  "update",
  "archive",
  "restore",
  "add",
  "remove",
  "promote",
  "demote",
  "resolve",
  "reopen",
]);

export function mutationSchema<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({
      schema: z.literal(FACET_SCHEMA),
      operation: mutationOperationSchema,
      entityId: idSchema,
      baseEventId: z
        .string()
        .regex(/^[0-9a-f]{64}$/i)
        .nullable(),
      value: valueSchema,
      importMetadata: importMetadataSchema.optional(),
    })
    .strict();
}

export const deploymentMutationSchema = mutationSchema(deploymentControlSchema);
export const boardMutationSchema = mutationSchema(boardSchema);
export const membershipMutationSchema = mutationSchema(membershipSchema);
export const subjectMutationSchema = mutationSchema(subjectSchema);
export const featureAreaMutationSchema = mutationSchema(featureAreaSchema);
export const capabilityMutationSchema = mutationSchema(capabilitySchema);
export const assessmentMutationSchema = mutationSchema(assessmentSchema);
export const threadStateMutationSchema = mutationSchema(threadStateValueSchema);
