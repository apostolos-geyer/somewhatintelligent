/** PURE file/byte helpers — no `cloudflare:workers`, safe in browser and worker. */

/** Hex SHA-256 of file/byte content — the content hash roadie's upload APIs require. */
export async function sha256Hex(data: File | ArrayBuffer): Promise<string> {
  const buf = data instanceof File ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Human-friendly byte size; 0 (unsized draft) collapses to a dash. */
export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
