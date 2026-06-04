/**
 * Download a binary asset from a URL using the global fetch.
 *
 * Node 18+ ships fetch with automatic redirect handling for `redirect: "follow"`,
 * which is exactly what GitHub release-asset URLs require (they 302 to S3).
 */
export async function downloadBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "reponova-grammar-fetcher/0.0.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} for ${url}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}
