import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net, { BlockList } from 'node:net';

const ipv4Blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  ipv4Blocked.addSubnet(address, prefix, 'ipv4');
}

const ipv6Blocked = [
  ['64:ff9b::', 96], // well-known NAT64 prefix
  ['64:ff9b:1::', 48], // local-use NAT64 prefix
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2001:db8::', 32], // documentation
  ['2001:2::', 48], // benchmarking
  ['2002::', 16], // 6to4 transition
  ['3ffe::', 16], // deprecated 6bone
  ['3fff::', 20], // documentation
].map(([address, prefix]) => [ipv6ToBigInt(address), prefix]);

function ipv6ToBigInt(input) {
  let address = String(input).toLowerCase();
  if (address.includes('%')) return null; // scoped interface addresses are never public targets

  const ipv4Tail = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const ip = ipv4Tail[1].split('.').map(Number);
    if (ip.some((part) => part < 0 || part > 255)) return null;
    const high = ((ip[0] << 8) | ip[1]).toString(16);
    const low = ((ip[2] << 8) | ip[3]).toString(16);
    address = `${address.slice(0, address.length - ipv4Tail[1].length)}${high}:${low}`;
  }

  if ((address.match(/::/g) || []).length > 1) return null;
  const compressed = address.includes('::');
  const [leftRaw, rightRaw = ''] = address.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((compressed && missing < 1) || (!compressed && missing !== 0)) return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
  return groups.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function isInIpv6Subnet(value, network, prefix) {
  if (network == null) return false;
  return value >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);
}

export function isPublicIp(address) {
  const value = String(address).replace(/^\[|\]$/g, '');
  const family = net.isIP(value);
  if (family === 4) return !ipv4Blocked.check(value, 'ipv4');
  if (family !== 6) return false;

  const parsed = ipv6ToBigInt(value);
  if (parsed == null) return false;

  // IPv4-mapped IPv6 must inherit the IPv4 classification.
  if (parsed >> 32n === 0xffffn) {
    const tail = Number(parsed & 0xffffffffn);
    const mapped = [tail >>> 24, (tail >>> 16) & 255, (tail >>> 8) & 255, tail & 255].join('.');
    return isPublicIp(mapped);
  }

  // Only global-unicast 2000::/3 is eligible, with special-purpose ranges excluded.
  if (parsed >> 125n !== 1n) return false;
  return !ipv6Blocked.some(([network, prefix]) => isInIpv6Subnet(parsed, network, prefix));
}

const NON_PUBLIC_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.test'];

function normalizeHostname(hostname) {
  return String(hostname).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

/** Resolve once and return the exact address set that the HTTP connection will use. */
export async function resolveTargetAddresses(target, { blockPrivate = false, signal } = {}) {
  const hostname = normalizeHostname(target.hostname);
  if (!hostname || hostname.includes('%')) throw new Error('invalid upstream hostname');

  const family = net.isIP(hostname);
  let addresses;
  if (family) {
    addresses = [{ address: hostname, family }];
  } else {
    if (blockPrivate && NON_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new Error('private network target is not allowed');
    }
    const records = await dnsLookupWithSignal(hostname, signal);
    addresses = records.map(({ address, family: ipFamily }) => ({ address, family: ipFamily }));
  }

  if (!addresses.length || (blockPrivate && addresses.some(({ address }) => !isPublicIp(address)))) {
    throw new Error('private network target is not allowed');
  }
  return addresses;
}

async function dnsLookupWithSignal(hostname, signal) {
  if (!signal) return dns.lookup(hostname, { all: true, verbatim: true });
  if (signal.aborted) throw signal.reason || new Error('upstream timeout');
  let onAbort;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason || new Error('upstream timeout'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Native HTTP request with DNS pinned to the already validated address set. */
export function requestPinned(target, addresses, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const lookup = (_hostname, options, callback) => {
      if (options?.all) {
        callback(null, addresses.map(({ address, family }) => ({ address, family })));
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    };
    const req = transport.request(target, {
      method,
      headers,
      signal,
      lookup,
      autoSelectFamily: addresses.length > 1,
      maxHeaderSize: 32 * 1024,
    }, resolve);
    req.once('error', reject);
    req.end(body);
  });
}

export async function readBodyLimited(request, limit, signal) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  const onAbort = () => reader.cancel(signal.reason).catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readResponseLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) {
      response.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
