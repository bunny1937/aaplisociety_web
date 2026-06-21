import dns from "node:dns";

const DEFAULT_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
let configuredDnsKey = null;

function getMongoDnsServers() {
  const raw = process.env.MONGODB_DNS_SERVERS;
  const customServers = raw
    ? raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  // Always keep public DNS servers available; the custom value is only an
  // extra fallback and should never block the default SRV resolution path.
  return [...new Set([...DEFAULT_DNS_SERVERS, ...customServers])];
}

export function configureMongoDns(uri) {
  if (!uri || !uri.startsWith("mongodb+srv://")) {
    return;
  }

  const servers = getMongoDnsServers();
  const key = servers.join(",");

  if (!servers.length || configuredDnsKey === key) {
    return;
  }

  try {
    dns.setServers(servers);
    configuredDnsKey = key;
  } catch (error) {
    console.warn("Mongo DNS fallback warning:", error.message);
  }
}
