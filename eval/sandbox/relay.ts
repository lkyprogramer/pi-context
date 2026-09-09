const CHAT_PATHS = new Set(["/chat/completions", "/v1/chat/completions"]);

export function allowUrl(url: string): boolean {
  if (url.includes("CONNECT")) return false;
  try {
    const u = new URL(url);
    if (u.protocol === "file:" || u.protocol === "unix:") return false;
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    return false;
  } catch {
    return false;
  }
}

export function allowBrokerRequest(method: string, url: string): boolean {
  if (String(method).toUpperCase() === "CONNECT") return false;
  if (String(method).toUpperCase() !== "POST") return false;
  try {
    const u = new URL(url, "http://127.0.0.1");
    if (u.protocol === "file:" || u.protocol === "unix:") return false;
    if (u.pathname === "/metrics" || u.pathname.endsWith("/metrics")) return false;
    return CHAT_PATHS.has(u.pathname);
  } catch {
    return false;
  }
}
