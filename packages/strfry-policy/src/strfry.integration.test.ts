import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Board,
  type Capability,
  COMMENT_CREATED_AT_TAG,
  COMMENT_ROOT_TAG,
  type ComparisonSubject,
  createCommentEditFactory,
  createMutationFactory,
  DELETED_COMMENT_TAG,
  DELETED_EDIT_TAG,
  FACET_DELETION_TAG,
  FACET_TAG,
  type FeatureArea,
  KINDS,
} from "@facet/protocol";
import { Relay } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { firstValueFrom, toArray } from "rxjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const strfryBinary = process.env.FACET_TEST_STRFRY_BIN;
const strfrySource = process.env.FACET_TEST_STRFRY_SOURCE;
const describeWithStrfry = strfryBinary && strfrySource ? describe : describe.skip;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describeWithStrfry("real strfry write-policy integration", () => {
  let temporaryDirectory = "";
  let relayUrl = "";
  let relayProcess: ChildProcessWithoutNullStreams | undefined;
  let relayLog = "";

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "facet-strfry-"));
    await mkdir(join(temporaryDirectory, "db"));
    const port = await availablePort();
    relayUrl = `ws://127.0.0.1:${port}`;
    const repository = repositoryRoot;
    const policy = join(repository, "deploy/facet-allowlist.js");
    const baseConfiguration = await readFile(join(strfrySource!, "strfry.conf"), "utf8");
    const configuration = baseConfiguration
      .replace('db = "./strfry-db/"', `db = "${join(temporaryDirectory, "db")}/"`)
      .replace("port = 7777", `port = ${port}`)
      .replace('serviceUrl = ""', `serviceUrl = "${relayUrl}"`)
      .replace('plugin = ""', `plugin = "${policy}"`);
    await writeFile(join(temporaryDirectory, "strfry.conf"), configuration);
    relayProcess = launchRelay(temporaryDirectory, repository, true);
    await waitForRelay(relayUrl, relayProcess);
  }, 30_000);

  afterAll(async () => {
    if (relayProcess) await stopRelay(relayProcess);
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("enforces NIP-42 and authorization while keeping public reads anonymous across replay", async () => {
    const superAdmin = new PrivateKeySigner();
    const outsider = new PrivateKeySigner();
    const superAdminPubkey = await superAdmin.getPublicKey();
    const now = Math.floor(Date.now() / 1000);
    const bootstrap = await createMutationFactory({
      kind: KINDS.deployment,
      operation: "bootstrap",
      entityId: "deployment",
      value: { superAdminPubkey },
      createdAt: now,
    }).sign(superAdmin);
    const adminRelay = new Relay(relayUrl, { publishRetry: { count: 0 } });

    await expect(adminRelay.publish(bootstrap, { retries: 0 })).rejects.toThrow("auth-required");
    expect((await adminRelay.authenticate(superAdmin)).ok).toBe(true);
    expect((await adminRelay.publish(bootstrap, { retries: 0 })).ok).toBe(true);

    const board: Board = {
      id: "white-noise",
      name: "White Noise",
      visibility: "public",
      state: "active",
    };
    const boardEvent = await createMutationFactory({
      kind: KINDS.board,
      operation: "create",
      entityId: board.id,
      value: board,
      createdAt: now + 1,
    }).sign(superAdmin);
    expect((await adminRelay.publish(boardEvent, { retries: 0 })).ok).toBe(true);

    const area: FeatureArea = {
      id: "messaging",
      boardId: board.id,
      title: "Messaging",
      orderKey: "a0",
      state: "active",
    };
    const areaEvent = await createMutationFactory({
      kind: KINDS.featureArea,
      operation: "create",
      entityId: area.id,
      value: area,
      createdAt: now + 2,
    }).sign(superAdmin);
    expect((await adminRelay.publish(areaEvent, { retries: 0 })).ok).toBe(true);
    const capability: Capability = {
      id: "editing",
      boardId: board.id,
      featureAreaId: area.id,
      title: "Editing",
      orderKey: "a0",
      state: "active",
      desiredOutcome: "standardize",
      decisionStatus: "open",
      priority: "now",
      links: [],
    };
    const capabilityEvent = await createMutationFactory({
      kind: KINDS.capability,
      operation: "create",
      entityId: capability.id,
      value: capability,
      createdAt: now + 3,
    }).sign(superAdmin);
    expect((await adminRelay.publish(capabilityEvent, { retries: 0 })).ok).toBe(true);
    const comment = await superAdmin.signEvent({
      kind: KINDS.comment,
      created_at: now + 4,
      content: "Original body",
      tags: [
        ["-"],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["e", capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "relay-delete-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    expect((await adminRelay.publish(comment, { retries: 0 })).ok).toBe(true);
    const edit = await createCommentEditFactory({
      original: comment,
      content: "Replacement body",
      boardId: board.id,
      featureAreaId: area.id,
      capabilityId: capability.id,
      target: "target:capability",
      createdAt: now + 5,
    }).sign(superAdmin);
    expect((await adminRelay.publish(edit, { retries: 0 })).ok).toBe(true);
    const reply = await superAdmin.signEvent({
      kind: KINDS.comment,
      created_at: now + 6,
      content: "Surviving reply",
      tags: [
        ["-"],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["e", comment.id],
        ["k", String(KINDS.comment)],
        ["E", capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "relay-delete-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    expect((await adminRelay.publish(reply, { retries: 0 })).ok).toBe(true);
    const deletion = await superAdmin.signEvent({
      kind: KINDS.deletion,
      created_at: now + 7,
      content: "Deleted by author",
      tags: [
        ["-"],
        ["e", comment.id],
        ["e", edit.id],
        ["k", String(KINDS.comment)],
        ["k", String(KINDS.commentEdit)],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["x", "relay-delete-thread"],
        [COMMENT_ROOT_TAG, comment.id],
        [COMMENT_CREATED_AT_TAG, String(comment.created_at)],
        [DELETED_COMMENT_TAG, comment.id],
        [DELETED_EDIT_TAG, edit.id],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
        ["t", "target:capability"],
      ],
    });
    expect((await adminRelay.publish(deletion, { retries: 0 })).ok).toBe(true);
    const deletedPayloads = await firstValueFrom(
      adminRelay.request({ ids: [comment.id, edit.id] }).pipe(toArray()),
    );
    expect(deletedPayloads).toEqual([]);

    const privateBoard: Board = {
      id: "private-board",
      name: "Private",
      visibility: "private",
      state: "active",
    };
    const privateEvent = await createMutationFactory({
      kind: KINDS.board,
      operation: "create",
      entityId: privateBoard.id,
      value: privateBoard,
      createdAt: now + 8,
    }).sign(superAdmin);
    const privateResponse = await adminRelay.publish(privateEvent, { retries: 0 });
    expect(privateResponse.ok).toBe(false);
    expect(privateResponse.message).toContain("public boards only");

    const outsiderRelay = new Relay(relayUrl, { publishRetry: { count: 0 } });
    const subject: ComparisonSubject = {
      id: "ios",
      boardId: board.id,
      name: "iOS",
      orderKey: "a0",
      state: "active",
      includeInGapAnalysis: true,
      locked: false,
    };
    const unauthorizedSubject = await createMutationFactory({
      kind: KINDS.subject,
      operation: "create",
      entityId: subject.id,
      value: subject,
      createdAt: now + 9,
    }).sign(outsider);
    await expect(outsiderRelay.publish(unauthorizedSubject, { retries: 0 })).rejects.toThrow(
      "auth-required",
    );
    expect((await outsiderRelay.authenticate(outsider)).ok).toBe(true);
    const outsiderResponse = await outsiderRelay.publish(unauthorizedSubject, { retries: 0 });
    expect(outsiderResponse.ok).toBe(false);
    expect(outsiderResponse.message).toContain("current board members");

    const publicReader = new Relay(relayUrl);
    const publicEvents = await firstValueFrom(
      publicReader.request({ kinds: [KINDS.deployment, KINDS.board] }).pipe(toArray()),
    );
    expect(publicEvents.map((event) => event.id)).toEqual(
      expect.arrayContaining([bootstrap.id, boardEvent.id]),
    );
    publicReader.close();
    outsiderRelay.close();
    adminRelay.close();

    await stopRelay(relayProcess!);
    relayProcess = launchRelay(temporaryDirectory, repositoryRoot, false);
    await waitForRelay(relayUrl, relayProcess);
    const afterReplay = new Relay(relayUrl);
    const replayedEvents = await firstValueFrom(
      afterReplay
        .request({ kinds: [KINDS.deployment, KINDS.board, KINDS.deletion, KINDS.comment] })
        .pipe(toArray()),
    );
    expect(replayedEvents.map((event) => event.id)).toEqual(
      expect.arrayContaining([bootstrap.id, boardEvent.id, deletion.id, reply.id]),
    );
    expect(replayedEvents.map((event) => event.id)).not.toEqual(
      expect.arrayContaining([comment.id, edit.id]),
    );
    afterReplay.close();
  }, 30_000);

  function launchRelay(directory: string, repository: string, firstStart: boolean) {
    const child = spawn(strfryBinary!, ["relay"], {
      cwd: directory,
      env: {
        ...globalThis.process.env,
        STRFRY_CONFIG: join(directory, "strfry.conf"),
        FACET_REPOSITORY: repository,
        FACET_STRFRY_BIN: strfryBinary!,
        FACET_STRFRY_DIR: directory,
        FACET_REQUIRE_NIP42: "true",
        FACET_ALLOW_OTHER_EVENTS: "false",
        ...(firstStart ? { FACET_POLICY_SEED_FILE: "/dev/null" } : {}),
      },
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (output: string) => {
      relayLog += output;
    });
    return child;
  }

  async function waitForRelay(url: string, process: ChildProcessWithoutNullStreams): Promise<void> {
    const httpUrl = url.replace(/^ws:/u, "http:");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (process.exitCode !== null) throw new Error(`strfry exited early.\n${relayLog}`);
      try {
        const response = await fetch(httpUrl);
        if (response.ok) return;
      } catch {
        // The disposable relay has not bound its socket yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${url}.\n${relayLog}`);
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopRelay(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await once(process, "exit");
}
