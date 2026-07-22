const compose = ["docker", "compose", "-f", "compose.local.yml"];

await run(["bun", "run", "build:relay-policy"]);
await run([...compose, "up", "--build", "--detach", "--wait", "relay"]);

console.log("\nFacet local relay is ready at ws://127.0.0.1:7777");
console.log("The app will be available at http://127.0.0.1:5173\n");

const web = Bun.spawn(["bun", "--filter", "@facet/web", "dev"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_FACET_RELAY_URL: "ws://127.0.0.1:7777",
    VITE_FACET_PROFILE_RELAYS: "wss://purplepag.es,wss://indexer.coracle.social",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await web.exited;
await run([...compose, "stop", "relay"], false);
process.exitCode = stopping ? 0 : exitCode;

async function run(command: string[], throwOnError = true): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (throwOnError && exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with code ${exitCode}`);
  }
  return exitCode;
}
