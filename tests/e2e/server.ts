const appPort = process.env.FACET_E2E_APP_PORT ?? "5173";
const relayPort = Number(process.env.FACET_E2E_RELAY_PORT ?? "17777");

const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: relayPort,
  fetch(request, server) {
    if (server.upgrade(request)) return undefined;
    return new Response("Facet test relay", { status: 200 });
  },
  websocket: {
    message(socket, message) {
      try {
        const frame = JSON.parse(
          typeof message === "string" ? message : Buffer.from(message).toString("utf8"),
        ) as unknown[];
        if (frame[0] === "REQ" && typeof frame[1] === "string") {
          socket.send(JSON.stringify(["EOSE", frame[1]]));
        } else if (
          (frame[0] === "EVENT" || frame[0] === "AUTH") &&
          typeof frame[1] === "object" &&
          frame[1] &&
          "id" in frame[1]
        ) {
          socket.send(JSON.stringify(["OK", String(frame[1].id), true, "accepted"]));
        }
      } catch {
        socket.send(JSON.stringify(["NOTICE", "invalid test relay frame"]));
      }
    },
  },
});

const web = Bun.spawn(["bun", "run", "dev", "--host", "127.0.0.1", "--port", appPort], {
  cwd: "apps/web",
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = () => {
  relay.stop(true);
  web.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await web.exited;
relay.stop(true);
process.exit(exitCode);
