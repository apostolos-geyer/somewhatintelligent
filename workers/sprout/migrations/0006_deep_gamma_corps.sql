CREATE TABLE `education_award` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`period` text NOT NULL,
	`fund_description` text NOT NULL,
	`covers_text` text,
	`closes_at` integer NOT NULL,
	`winner_user_id` text,
	`winner_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `education_award_period_idx` ON `education_award` (`brand_id`,`period`);--> statement-breakpoint
CREATE TABLE `portal_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_access_requests_unique_idx` ON `portal_access_requests` (`brand_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `portal_access_requests_brand_status_idx` ON `portal_access_requests` (`brand_id`,`status`);