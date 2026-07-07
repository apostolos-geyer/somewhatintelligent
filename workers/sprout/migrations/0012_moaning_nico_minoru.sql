CREATE TABLE `brand_theme` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`live_theme_json` text DEFAULT '{}' NOT NULL,
	`draft_theme_json` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`live_published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_theme_org_idx` ON `brand_theme` (`org_id`);--> statement-breakpoint
CREATE TABLE `portal_config` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`logo_ref` text,
	`sections_json` text DEFAULT '[]' NOT NULL,
	`feed_label` text DEFAULT 'Enter the Grow' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_config_org_idx` ON `portal_config` (`org_id`);--> statement-breakpoint
DROP TABLE `brand_config`;