CREATE TABLE `portal_members` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'budtender' NOT NULL,
	`source` text DEFAULT 'request' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_members_unique_idx` ON `portal_members` (`brand_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `portal_members_user_idx` ON `portal_members` (`user_id`);