export type AppConfig = {
  appName: string;
  relayUrl: string;
  profileRelays: string[];
  importerPubkeys: string[];
  demoMode: boolean;
};

export const appConfig: AppConfig = {
  appName: import.meta.env.VITE_FACET_APP_NAME || "Facet",
  relayUrl: import.meta.env.VITE_FACET_RELAY_URL || "ws://127.0.0.1:7777",
  profileRelays: splitList(
    import.meta.env.VITE_FACET_PROFILE_RELAYS || "wss://purplepag.es,wss://indexer.coracle.social",
  ),
  importerPubkeys: splitList(import.meta.env.VITE_FACET_IMPORTER_PUBKEYS || ""),
  demoMode: import.meta.env.VITE_FACET_DEMO === "true",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
