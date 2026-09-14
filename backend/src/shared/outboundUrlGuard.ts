import dns from "node:dns/promises";
import net from "node:net";
import { env } from "../config/env.js";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIPv4(normalized.replace("::ffff:", ""));
  }
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

export async function assertSafeOutboundUrl(rawUrl: string, context: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${context} URL is invalid`);
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error(`${context} URL must use HTTP or HTTPS`);
  }

  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${context} URL must use HTTPS in production`);
  }

  if (env.OUTBOUND_ALLOW_PRIVATE_URLS) return url;

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error(`${context} URL targets a blocked host`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`${context} URL targets a private IP`);
    return url;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`${context} URL host could not be resolved`);
  }

  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error(`${context} URL resolves to a private or unsafe address`);
  }

  return url;
}
