-- RFC-0001 "Store D1 catalog revisions": normalize the flat product aggregate
-- into the release model (thin `product` + `product_draft` + immutable
-- `product_release` + storage-neutral `product_image` + `product_release_image`)
-- and add the operator audit / deletion-intent / media-GC tables.
--
-- The pre-release `product` / `product_image` shape is REPLACED, not migrated:
-- there is no meaningful production catalog (RFC "no staged data migration"), so
-- the old tables are dropped and recreated with no data copy. `product_flat` is a
-- backward-compatible read view (flat shape sourced from the draft) that keeps
-- the pre-release read paths compiling/behaving until T9/T10 repoint them.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `product_image`;--> statement-breakpoint
DROP TABLE `product`;--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`active_release_id` text,
	`created_by_sub` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_release_id`) REFERENCES `product_release`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "product_status_valid" CHECK(status IN ('draft', 'active', 'unavailable', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_slug_unique` ON `product` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_product_status_updated` ON `product` (`status`,`updated_at` DESC);--> statement-breakpoint
CREATE TABLE `product_draft` (
	`product_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`price_cents` integer NOT NULL,
	`updated_by_sub` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_draft_revision_min" CHECK(revision >= 1),
	CONSTRAINT "product_draft_price_non_negative" CHECK(price_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE `product_release` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`version` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`price_cents` integer NOT NULL,
	`published_by_sub` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_release_price_non_negative" CHECK(price_cents >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_release_product_version_unique` ON `product_release` (`product_id`,`version`);--> statement-breakpoint
CREATE TABLE `product_image` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text NOT NULL,
	`role` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_image_role_valid" CHECK(role IN ('cover', 'gallery', 'evidence')),
	CONSTRAINT "product_image_state_valid" CHECK(state IN ('pending', 'ready', 'failed')),
	CONSTRAINT "product_image_size_non_negative" CHECK(size_bytes >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_image_storage_key_unique` ON `product_image` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_product_image_product` ON `product_image` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_release_image` (
	`release_id` text NOT NULL,
	`image_id` text NOT NULL,
	`alt` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`release_id`, `image_id`),
	FOREIGN KEY (`release_id`) REFERENCES `product_release`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `product_image`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_operator_event` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_sub` text NOT NULL,
	`operator_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`request_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`outcome` text NOT NULL,
	`detail_json` text,
	`response_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_operator_event_idempotency_action_unique` ON `store_operator_event` (`idempotency_key`,`action`);--> statement-breakpoint
CREATE TABLE `store_operator_deletion_intent` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`operator_sub` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`impact_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `store_media_gc_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE VIEW `product_flat` AS select "product"."id", "product"."slug", "product_draft"."title", "product_draft"."description_markdown", "product_draft"."price_cents", "product"."status", "product"."created_by_sub", "product"."created_at", "product"."updated_at" from "product" inner join "product_draft" on "product"."id" = "product_draft"."product_id";--> statement-breakpoint
PRAGMA foreign_keys=ON;
