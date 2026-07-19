CREATE TABLE `media_gc_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operator_deletion_intent` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`operator_sub` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`impact_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `operator_event` (
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
CREATE UNIQUE INDEX `u_operator_event_key` ON `operator_event` (`idempotency_key`,`action`);--> statement-breakpoint
CREATE INDEX `idx_publisher_event_target` ON `operator_event` (`target_type`,`target_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `page_draft` (
	`page_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`document_json` text NOT NULL,
	`updated_by_sub` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "page_draft_revision_positive" CHECK(revision >= 1)
);
--> statement-breakpoint
CREATE TABLE `page_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`page_key` text NOT NULL,
	`active_release_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_release_id`) REFERENCES `page_release`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "page_entry_key_valid" CHECK(page_key IN ('home', 'shop', 'writing', 'software', 'about'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_entry_page_key_unique` ON `page_entry` (`page_key`);--> statement-breakpoint
CREATE TABLE `page_release` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`version` text NOT NULL,
	`schema_version` integer NOT NULL,
	`document_json` text NOT NULL,
	`published_by_sub` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_page_release_version` ON `page_release` (`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `publisher_media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`role` text NOT NULL,
	`alt` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_by_sub` text NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	CONSTRAINT "publisher_media_owner_type_valid" CHECK(owner_type IN ('text', 'software', 'page')),
	CONSTRAINT "publisher_media_size_non_negative" CHECK(size_bytes >= 0),
	CONSTRAINT "publisher_media_state_valid" CHECK(state IN ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_media_storage_key_unique` ON `publisher_media` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_publisher_media_owner` ON `publisher_media` (`owner_type`,`owner_id`,`position`);--> statement-breakpoint
CREATE TABLE `publisher_release_media` (
	`owner_type` text NOT NULL,
	`release_id` text NOT NULL,
	`media_id` text NOT NULL,
	`role` text NOT NULL,
	`alt` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`owner_type`, `release_id`, `media_id`),
	FOREIGN KEY (`media_id`) REFERENCES `publisher_media`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publisher_release_media_owner_type_valid" CHECK(owner_type IN ('text', 'page'))
);
--> statement-breakpoint
CREATE INDEX `idx_publisher_release_media_lookup` ON `publisher_release_media` (`media_id`,`owner_type`,`release_id`);--> statement-breakpoint
CREATE TABLE `software_draft` (
	`software_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`deck` text DEFAULT '' NOT NULL,
	`what_it_is_markdown` text DEFAULT '' NOT NULL,
	`destination_url` text DEFAULT '' NOT NULL,
	`action_label` text DEFAULT 'Open system' NOT NULL,
	`primary_media_id` text,
	`updated_by_sub` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`software_id`) REFERENCES `software_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "software_draft_revision_positive" CHECK(revision >= 1)
);
--> statement-breakpoint
CREATE TABLE `software_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`created_by_sub` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`retired_at` integer,
	CONSTRAINT "software_entry_state_valid" CHECK(state IN ('draft', 'published', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `software_entry_slug_unique` ON `software_entry` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_software_entry_state_updated` ON `software_entry` (`state`,"updated_at" desc);--> statement-breakpoint
CREATE TABLE `software_publication` (
	`software_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`deck` text NOT NULL,
	`what_it_is_markdown` text NOT NULL,
	`destination_url` text NOT NULL,
	`action_label` text NOT NULL,
	`primary_media_id` text,
	`published_by_sub` text NOT NULL,
	`published_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`software_id`) REFERENCES `software_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `software_publication_slug_unique` ON `software_publication` (`slug`);--> statement-breakpoint
CREATE TABLE `software_publication_media` (
	`software_id` text NOT NULL,
	`media_id` text NOT NULL,
	`role` text NOT NULL,
	`alt` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`software_id`, `media_id`),
	FOREIGN KEY (`software_id`) REFERENCES `software_publication`(`software_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `publisher_media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_software_publication_media_lookup` ON `software_publication_media` (`media_id`,`software_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_slug_unique` ON `tag` (`slug`);--> statement-breakpoint
CREATE TABLE `text_draft` (
	`text_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`deck` text,
	`body_markdown` text DEFAULT '' NOT NULL,
	`updated_by_sub` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`text_id`) REFERENCES `text_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "text_draft_revision_positive" CHECK(revision >= 1)
);
--> statement-breakpoint
CREATE TABLE `text_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`active_release_id` text,
	`created_by_sub` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`active_release_id`) REFERENCES `text_release`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "text_entry_state_valid" CHECK(state IN ('draft', 'published', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_entry_slug_unique` ON `text_entry` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_text_entry_state_updated` ON `text_entry` (`state`,"updated_at" desc);--> statement-breakpoint
CREATE TABLE `text_link` (
	`id` text PRIMARY KEY NOT NULL,
	`from_text_id` text NOT NULL,
	`to_text_id` text,
	`to_slug` text NOT NULL,
	`is_dangling` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_text_id`) REFERENCES `text_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_text_id`) REFERENCES `text_entry`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "text_link_dangling_bool" CHECK(is_dangling IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_text_link_from` ON `text_link` (`from_text_id`);--> statement-breakpoint
CREATE INDEX `idx_text_link_to` ON `text_link` (`to_text_id`);--> statement-breakpoint
CREATE TABLE `text_release` (
	`id` text PRIMARY KEY NOT NULL,
	`text_id` text NOT NULL,
	`version` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`deck` text,
	`body_markdown` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`published_by_sub` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`text_id`) REFERENCES `text_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `u_text_release_version` ON `text_release` (`text_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_text_release_public` ON `text_release` (`text_id`,"published_at" desc);--> statement-breakpoint
CREATE TABLE `text_tag` (
	`text_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`text_id`, `tag_id`),
	FOREIGN KEY (`text_id`) REFERENCES `text_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_text_tag_reverse` ON `text_tag` (`tag_id`,`text_id`);