import ipaddr from "ipaddr.js";

function parseAddress(value: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  try {
    return normalizeAddress(ipaddr.parse(value.trim()));
  } catch {
    return null;
  }
}

function normalizeAddress(
  parsed: ipaddr.IPv4 | ipaddr.IPv6,
): ipaddr.IPv4 | ipaddr.IPv6 {
  if (parsed.kind() !== "ipv6") return parsed;
  const ipv6 = parsed as ipaddr.IPv6;
  return ipv6.isIPv4MappedAddress() ? ipv6.toIPv4Address() : ipv6;
}

/** Matches only the address supplied by the server's trusted socket/proxy resolver. */
export function isIpAllowed(
  address: string,
  allowlist: readonly string[],
): boolean {
  const parsedAddress = parseAddress(address);
  if (!parsedAddress) return false;

  return allowlist.some((entry) => {
    try {
      const trimmed = entry.trim();
      if (!trimmed) return false;
      if (!trimmed.includes("/")) {
        const exact = parseAddress(trimmed);
        return (
          exact !== null &&
          parsedAddress.kind() === exact.kind() &&
          parsedAddress.toNormalizedString() === exact.toNormalizedString()
        );
      }
      const [network, prefix] = ipaddr.parseCIDR(trimmed);
      const normalizedNetwork = normalizeAddress(network);
      return (
        parsedAddress.kind() === normalizedNetwork.kind() &&
        parsedAddress.match([normalizedNetwork, prefix])
      );
    } catch {
      return false;
    }
  });
}

export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
