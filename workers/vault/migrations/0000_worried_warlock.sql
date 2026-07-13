CREATE TABLE `audit_recent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`dest` text,
	`label` text,
	`op` text NOT NULL,
	`outcome` text NOT NULL,
	`caller_app` text
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`dest` text NOT NULL,
	`label` text NOT NULL,
	`env` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`dek_wrapped` blob NOT NULL,
	`kek_version` integer NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer,
	`health` text DEFAULT 'ok' NOT NULL,
	`unhealthy_reason` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_dest_label` ON `grants` (`dest`,`label`);--> statement-breakpoint
CREATE UNIQUE INDEX `grants_dest_default` ON `grants` (`dest`) WHERE is_default = 1;--> statement-breakpoint
CREATE TABLE `oauth_state` (
	`nonce` text PRIMARY KEY NOT NULL,
	`dest` text NOT NULL,
	`label` text NOT NULL,
	`env` text,
	`scopes` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`exp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenant_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
