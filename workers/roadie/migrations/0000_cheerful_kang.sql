CREATE TABLE `blob_multipart_part` (
	`id` text PRIMARY KEY NOT NULL,
	`physical_blob_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`physical_blob_id`) REFERENCES `physical_blob`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_part` ON `blob_multipart_part` (`physical_blob_id`,`part_number`);--> statement-breakpoint
CREATE TABLE `blob_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`physical_blob_id` text NOT NULL,
	`app` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`caller_app` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`physical_blob_id`) REFERENCES `physical_blob`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ref_physical_blob` ON `blob_reference` (`physical_blob_id`);--> statement-breakpoint
CREATE INDEX `idx_ref_caller` ON `blob_reference` (`caller_app`);--> statement-breakpoint
CREATE UNIQUE INDEX `u_ref` ON `blob_reference` (`physical_blob_id`,`app`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `deletion_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`physical_blob_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dq_next` ON `deletion_queue` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `physical_blob` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`upload_mode` text NOT NULL,
	`part_size` integer,
	`part_count` integer,
	`r2_upload_id` text,
	`enforce_checksum` integer DEFAULT false NOT NULL,
	`refcount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finalized_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_pb_hash_alive` ON `physical_blob` (`hash`) WHERE "physical_blob"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_pb_pending_expiry` ON `physical_blob` (`created_at`);--> statement-breakpoint
CREATE TABLE `reconcile_cursor` (
	`id` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`last_run_at` integer,
	`total_processed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signed_url_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`url` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signed_url_cache_cache_key_unique` ON `signed_url_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_suc_expiry` ON `signed_url_cache` (`expires_at`);