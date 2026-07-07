CREATE TABLE `brand_config` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`logo_ref` text,
	`live_theme_json` text DEFAULT '{}' NOT NULL,
	`draft_theme_json` text DEFAULT '{}' NOT NULL,
	`live_sections_json` text DEFAULT '[]' NOT NULL,
	`draft_sections_json` text DEFAULT '[]' NOT NULL,
	`feed_label` text DEFAULT 'Enter the Grow' NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`live_published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_config_org_idx` ON `brand_config` (`org_id`);--> statement-breakpoint
CREATE TABLE `org_brand_directory` (
	`org_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo_ref` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_brand_dir_slug_idx` ON `org_brand_directory` (`slug`);