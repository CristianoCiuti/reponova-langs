import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";

export async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return sha256OfBuffer(buf);
}

export function sha256OfBuffer(buf: Buffer | Uint8Array): string {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}
