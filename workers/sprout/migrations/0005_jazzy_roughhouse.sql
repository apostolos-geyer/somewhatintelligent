CREATE TABLE `ai_custom_qa` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_custom_qa_brand_idx` ON `ai_custom_qa` (`brand_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `ai_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`chunk_idx` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`vectorize_id` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_embeddings_brand_idx` ON `ai_embeddings` (`brand_id`);--> statement-breakpoint
CREATE INDEX `ai_embeddings_source_idx` ON `ai_embeddings` (`brand_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `ai_qa_log` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`source` text,
	`source_id` text,
	`kind` text DEFAULT 'customer' NOT NULL,
	`escalated_booking_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_qa_log_brand_created_idx` ON `ai_qa_log` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_qa_log_brand_kind_idx` ON `ai_qa_log` (`brand_id`,`kind`);--> statement-breakpoint
CREATE TABLE `availability_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`host_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`slot_minutes` integer DEFAULT 30 NOT NULL,
	`is_group` integer DEFAULT 0 NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_windows_brand_time_idx` ON `availability_windows` (`brand_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`window_id` text NOT NULL,
	`host_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slot_starts_at` integer NOT NULL,
	`slot_ends_at` integer NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`note` text,
	`realtime_session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`window_id`) REFERENCES `availability_windows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_slot_idx` ON `bookings` (`window_id`,`slot_starts_at`);--> statement-breakpoint
CREATE INDEX `bookings_user_idx` ON `bookings` (`user_id`);--> statement-breakpoint
CREATE INDEX `bookings_brand_time_idx` ON `bookings` (`brand_id`,`slot_starts_at`);--> statement-breakpoint
CREATE INDEX `bookings_host_idx` ON `bookings` (`host_id`,`slot_starts_at`);--> statement-breakpoint
CREATE TABLE `contact_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`from_brand` integer DEFAULT 1 NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `contact_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_replies_thread_idx` ON `contact_replies` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_name` text NOT NULL,
	`store` text,
	`email` text NOT NULL,
	`topic` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_threads_brand_status_idx` ON `contact_threads` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `contact_threads_user_idx` ON `contact_threads` (`user_id`);--> statement-breakpoint
CREATE TABLE `group_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`host_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer,
	`recording_ref` text,
	`realtime_session_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `group_sessions_brand_time_idx` ON `group_sessions` (`brand_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`user_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `brand_id`, `type`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_brand_user_idx` ON `notifications` (`brand_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `session_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`registered_at` integer NOT NULL,
	`joined_at` integer,
	`left_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `group_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_attendance_unique_idx` ON `session_attendance` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `session_attendance_user_idx` ON `session_attendance` (`user_id`);