import type { OutlineComment } from "./types";

type OutlineEnvelope<T> = {
  data: T;
  pagination?: { offset?: number; limit?: number; nextPath?: string };
};

export class OutlineApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async document(documentId: string): Promise<Record<string, unknown>> {
    const response = await this.call<Record<string, unknown>>("documents.info", { id: documentId });
    return response.data;
  }

  async comments(documentId: string): Promise<OutlineComment[]> {
    const comments: OutlineComment[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const response = await this.call<unknown[]>("comments.list", {
        documentId,
        includeResolved: true,
        offset,
        limit,
        sort: "createdAt",
        direction: "ASC",
      });
      const batch = response.data.map(normalizeComment);
      comments.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }
    return comments;
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<OutlineEnvelope<T>> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, "")}/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Outline ${method} failed (${response.status}): ${await response.text()}`);
    return (await response.json()) as OutlineEnvelope<T>;
  }
}

function normalizeComment(value: unknown): OutlineComment {
  const row = value as Record<string, any>;
  const text = String(row.data?.text ?? row.text ?? "").trim();
  const reactions = Array.isArray(row.reactions)
    ? row.reactions.map((reaction: Record<string, any>) => ({
        emoji: String(reaction.emoji ?? reaction.reaction ?? "+"),
        ...(reaction.user?.name ? { userName: String(reaction.user.name) } : {}),
      }))
    : [];
  return {
    id: String(row.id),
    text,
    ...(row.parentCommentId ? { parentCommentId: String(row.parentCommentId) } : {}),
    createdAt: String(row.createdAt),
    ...(row.updatedAt ? { updatedAt: String(row.updatedAt) } : {}),
    ...(row.resolvedAt ? { resolvedAt: String(row.resolvedAt) } : {}),
    ...(row.anchorText ? { anchorText: String(row.anchorText) } : {}),
    authorName: String(row.createdBy?.name ?? row.user?.name ?? "Unknown Outline user"),
    reactions,
    attachmentOnly: text.length === 0 && Boolean(row.data?.attachment || row.attachment),
  };
}
