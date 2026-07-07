CREATE TABLE `attempt_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`is_correct` integer NOT NULL,
	`points_awarded` real NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempt_answers_attempt_idx` ON `attempt_answers` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`quiz_id` text NOT NULL,
	`user_id` text NOT NULL,
	`shuffle_seed` integer NOT NULL,
	`answers_json` text DEFAULT '{}' NOT NULL,
	`current_question` integer DEFAULT 0 NOT NULL,
	`score` real,
	`max_score` real NOT NULL,
	`passed` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`started_at` integer NOT NULL,
	`deadline_at` integer,
	`submitted_at` integer,
	`time_spent_seconds` integer,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_user_quiz_idx` ON `attempts` (`user_id`,`quiz_id`,`status`);--> statement-breakpoint
CREATE INDEX `attempts_brand_submitted_idx` ON `attempts` (`brand_id`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`quiz_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`attempt_id` text NOT NULL,
	`awarded_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certifications_unique_idx` ON `certifications` (`brand_id`,`user_id`,`quiz_id`);--> statement-breakpoint
CREATE INDEX `certifications_user_idx` ON `certifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `deck_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_page` integer DEFAULT 1 NOT NULL,
	`time_spent_seconds` integer DEFAULT 0 NOT NULL,
	`opened_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_progress_user_idx` ON `deck_progress` (`deck_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `deck_progress_brand_idx` ON `deck_progress` (`brand_id`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`title` text NOT NULL,
	`product_line` text,
	`pdf_ref` text,
	`cover_thumb_ref` text,
	`page_count` integer DEFAULT 0 NOT NULL,
	`download_allowed` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `decks_brand_status_idx` ON `decks` (`brand_id`,`status`);--> statement-breakpoint
CREATE TABLE `drops` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`product_id` text NOT NULL,
	`headline` text,
	`drops_at` integer NOT NULL,
	`ends_at` integer,
	`is_limited` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drops_brand_window_idx` ON `drops` (`brand_id`,`drops_at`);--> statement-breakpoint
CREATE INDEX `drops_product_idx` ON `drops` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`thc_pct` real,
	`cbd_pct` real,
	`terpenes_json` text DEFAULT '[]' NOT NULL,
	`effects_json` text DEFAULT '[]' NOT NULL,
	`talking_points_json` text DEFAULT '[]' NOT NULL,
	`format` text,
	`batch` text,
	`hero_image_ref` text,
	`availability` text DEFAULT 'available' NOT NULL,
	`available_note` text,
	`deck_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`order_idx` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `products_brand_cat_idx` ON `products` (`brand_id`,`category`);--> statement-breakpoint
CREATE INDEX `products_brand_status_idx` ON `products` (`brand_id`,`status`);--> statement-breakpoint
CREATE TABLE `question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`text` text NOT NULL,
	`image_ref` text,
	`is_correct` integer DEFAULT 0 NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_options_question_idx` ON `question_options` (`question_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`image_ref` text,
	`points` real DEFAULT 1 NOT NULL,
	`explanation` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_quiz_order_idx` ON `questions` (`quiz_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pass_threshold` integer DEFAULT 80 NOT NULL,
	`retakes_allowed` integer DEFAULT 1 NOT NULL,
	`max_attempts` integer,
	`time_limit_seconds` integer,
	`cert_name` text,
	`on_leaderboard` integer DEFAULT 1 NOT NULL,
	`shuffle_questions` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quizzes_brand_status_idx` ON `quizzes` (`brand_id`,`status`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_name` text NOT NULL,
	`store` text,
	`rating` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_one_per_user_idx` ON `reviews` (`brand_id`,`product_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `reviews_product_idx` ON `reviews` (`product_id`);--> statement-breakpoint
CREATE TABLE `user_brand_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`period` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`quiz_points` real DEFAULT 0 NOT NULL,
	`deck_points` real DEFAULT 0 NOT NULL,
	`activity_points` real DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_brand_scores_unique_idx` ON `user_brand_scores` (`brand_id`,`user_id`,`period`);--> statement-breakpoint
CREATE INDEX `user_brand_scores_leaderboard_idx` ON `user_brand_scores` (`brand_id`,`period`,`score`);--> statement-breakpoint
CREATE INDEX `user_brand_scores_period_score_idx` ON `user_brand_scores` (`period`,`score`);