// Browser-side product-image upload driver. Per file:
//   1. SHA-256 the bytes (hex)
//   2. registerProductImage → branch on envelope.status
//   3. runUpload (single-part PUT or multipart loop) — shared roadie client
//   4. finalizeProductImage (skipped on dedup-ready)
import { useCallback, useState } from "react";
import { runUpload, UploadError } from "@si/roadie-service/client/upload";
import {
  finalizeProductImage,
  recordProductImagePart,
  registerProductImage,
  signProductImagePart,
} from "@/lib/upload.functions";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

export function useImageUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (productId: string, file: File): Promise<{ ok: boolean; error?: string }> => {
      setUploading(true);
      try {
        const sha256 = await sha256Hex(file);
        const reg = await registerProductImage({
          data: {
            productId,
            size: file.size,
            contentType: file.type || "application/octet-stream",
            sha256,
            alt: file.name,
          },
        });
        if (!reg.ok) return { ok: false, error: reg.message ?? reg.error };

        const imageId = reg.imageId;
        if (reg.upload.status !== "ready") {
          await runUpload({
            file,
            upload: reg.upload,
            driver: {
              signPart: async ({ partNumber, size }) => {
                const r = await signProductImagePart({ data: { imageId, partNumber, size } });
                if (!r.ok) throw new Error(r.error);
                return { uploadUrl: r.uploadUrl, requiredHeaders: r.requiredHeaders };
              },
              recordPart: async ({ partNumber, etag, size }) => {
                const r = await recordProductImagePart({
                  data: { imageId, partNumber, etag, size },
                });
                if (!r.ok) throw new Error(r.error);
              },
            },
          });
          const fin = await finalizeProductImage({ data: { imageId } });
          if (!fin.ok) return { ok: false, error: fin.error };
        }
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof UploadError
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        return { ok: false, error: message };
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  return { upload, uploading };
}
