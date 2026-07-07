CREATE TABLE `budtender_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'cansell' NOT NULL,
	`issuer` text DEFAULT 'CanSell' NOT NULL,
	`credential_number` text,
	`proof_ref` text,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`verified_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budtender_credentials_user_kind_idx` ON `budtender_credentials` (`user_id`,`kind`);