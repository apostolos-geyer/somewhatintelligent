CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_name` text NOT NULL,
	`store` text,
	`body` text NOT NULL,
	`team` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_room_created_idx` ON `chat_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`title` text DEFAULT 'Group Chat' NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_rooms_brand_idx` ON `chat_rooms` (`brand_id`);--> statement-breakpoint
CREATE TABLE `comment_likes` (
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`comment_id`, `user_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_name` text NOT NULL,
	`store` text,
	`body` text NOT NULL,
	`brand_team` integer DEFAULT 0 NOT NULL,
	`heart_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_post_created_idx` ON `comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_likes` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_media` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`media_ref` text NOT NULL,
	`kind` text NOT NULL,
	`order_idx` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_media_post_idx` ON `post_media` (`post_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`author_id` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`product_id` text,
	`like_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`first_comment_json` text,
	`brand_team` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `posts_brand_created_idx` ON `posts` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `presence` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
