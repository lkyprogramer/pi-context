export function allowUrl(url: string): boolean {
  if (url.includes("CONNECT")) return false;
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (u.protocol === "file:" || u.protocol === "unix:") return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
