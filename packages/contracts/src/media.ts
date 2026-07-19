/**
 * Domain-owned, storage-neutral media DTOs (RFC-0001 D10 + "Media contracts").
 *
 * These carry a domain media `id` and an eligibility-resolved `href`. No
 * Roadie registration / multipart / finalize / reference-ID / signed-URL /
 * garbage-collection concept appears here or in any other contract — the private
 * `MediaStorage` port that hides those lives inside each owning backend
 * (track T5), not in this package.
 */
export interface PublicMediaRef {
  id: string;
  href: string;
  alt: string;
  role: string;
  position: number;
  contentType: string;
  width: number | null;
  height: number | null;
}

export type MediaMutationError =
  | "not_found"
  | "unsupported_type"
  | "invalid_size"
  | "invalid_role"
  | "storage_unavailable";

export interface ProductMediaDTO {
  id: string;
  productId: string;
  alt: string;
  role: "cover" | "gallery" | "evidence";
  position: number;
  state: "ready" | "failed";
  href: string | null;
  contentType: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
}

export interface PublisherMediaDTO {
  id: string;
  ownerType: "text" | "software" | "page";
  ownerId: string;
  role: string;
  alt: string;
  position: number;
  state: "ready" | "failed";
  href: string | null;
  contentType: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
}
