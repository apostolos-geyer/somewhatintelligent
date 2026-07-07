PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_access_token`("id", "token", "client_id", "session_id", "user_id", "reference_id", "refresh_id", "expires_at", "created_at", "scopes") SELECT "id", "token", "client_id", "session_id", "user_id", "reference_id", "refresh_id", "expires_at", "created_at", "scopes" FROM `oauth_access_token`;--> statement-breakpoint
DROP TABLE `oauth_access_token`;--> statement-breakpoint
ALTER TABLE `__new_oauth_access_token` RENAME TO `oauth_access_token`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_token_unique` ON `oauth_access_token` (`token`);--> statement-breakpoint
CREATE TABLE `__new_oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_consent`("id", "client_id", "user_id", "reference_id", "scopes", "created_at", "updated_at") SELECT "id", "client_id", "user_id", "reference_id", "scopes", "created_at", "updated_at" FROM `oauth_consent`;--> statement-breakpoint
DROP TABLE `oauth_consent`;--> statement-breakpoint
ALTER TABLE `__new_oauth_consent` RENAME TO `oauth_consent`;--> statement-breakpoint
CREATE TABLE `__new_oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`auth_time` integer,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_refresh_token`("id", "token", "client_id", "session_id", "user_id", "reference_id", "expires_at", "created_at", "revoked", "auth_time", "scopes") SELECT "id", "token", "client_id", "session_id", "user_id", "reference_id", "expires_at", "created_at", "revoked", "auth_time", "scopes" FROM `oauth_refresh_token`;--> statement-breakpoint
DROP TABLE `oauth_refresh_token`;--> statement-breakpoint
ALTER TABLE `__new_oauth_refresh_token` RENAME TO `oauth_refresh_token`;--> statement-breakpoint
ALTER TABLE `two_factor` ADD `verified` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `display_username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);