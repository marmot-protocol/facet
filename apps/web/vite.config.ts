import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const boardRelay = env.VITE_FACET_RELAY_URL || "ws://127.0.0.1:7777";
  const profileRelays = splitList(
    env.VITE_FACET_PROFILE_RELAYS || "wss://purplepag.es,wss://indexer.coracle.social",
  );

  return {
    envDir: workspaceRoot,
    plugins: [facetCsp([boardRelay, ...profileRelays]), react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    build: {
      sourcemap: true,
      target: "es2022",
    },
  };
});

function facetCsp(relayUrls: string[]): Plugin {
  const connectSources = ["'self'", ...new Set(relayUrls.map(assertWebSocketUrl))].join(" ");
  const content = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
  ].join("; ");

  return {
    name: "facet-csp",
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content },
          injectTo: "head-prepend",
        },
      ],
    },
  };
}

function assertWebSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Relay URL must use ws:// or wss://: ${value}`);
  }
  return url.toString();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
