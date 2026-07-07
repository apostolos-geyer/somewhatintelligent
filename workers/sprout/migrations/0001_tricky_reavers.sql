CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_events_brand_actor_idx` ON `analytics_events` (`brand_id`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_brand_type_idx` ON `analytics_events` (`brand_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_target_idx` ON `analytics_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`type` text NOT NULL,
	`file_ref` text NOT NULL,
	`thumb_ref` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`physical_available` integer DEFAULT 0 NOT NULL,
	`physical_max_qty` integer,
	`download_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `assets_brand_cat_idx` ON `assets` (`brand_id`,`category`);--> statement-breakpoint
CREATE INDEX `assets_brand_physical_idx` ON `assets` (`brand_id`,`physical_available`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_brand_created_idx` ON `audit_log` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `banner_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`category_tag` text,
	`headline` text NOT NULL,
	`line` text DEFAULT '' NOT NULL,
	`link_json` text DEFAULT '{}' NOT NULL,
	`dismissible` integer DEFAULT 1 NOT NULL,
	`live_from` integer,
	`expires_at` integer,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`order_idx` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `banner_cards_brand_idx` ON `banner_cards` (`brand_id`);--> statement-breakpoint
CREATE INDEX `banner_cards_window_idx` ON `banner_cards` (`brand_id`,`live_from`,`expires_at`);--> statement-breakpoint
CREATE TABLE `banner_dismissals` (
	`banner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	PRIMARY KEY(`banner_id`, `user_id`),
	FOREIGN KEY (`banner_id`) REFERENCES `banner_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `hero_slides` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`image_ref` text NOT NULL,
	`category` text,
	`headline` text,
	`order_idx` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hero_slides_brand_order_idx` ON `hero_slides` (`brand_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `physical_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`user_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`store` text NOT NULL,
	`ship_street` text NOT NULL,
	`ship_city` text NOT NULL,
	`ship_province` text NOT NULL,
	`ship_postal` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_phone` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'Requested' NOT NULL,
	`tracking` text,
	`decline_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `physical_requests_brand_status_idx` ON `physical_requests` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `physical_requests_user_idx` ON `physical_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `physical_requests_asset_idx` ON `physical_requests` (`asset_id`);