-- Hand-written SIBLING migration (per D-REVIEWS-CHECK-MIGRATION). drizzle-kit
-- regenerates 0002 on the next reviews schema change and would silently drop an
-- in-place CHECK edit, so the defence-in-depth constraints live here. The arktype
-- edge validator (rating 1..5, body <= 300) stays the PRIMARY guard.
--
-- SQLite cannot ALTER-ADD a CHECK, so the table is rebuilt. `reviews` is empty at
-- this point (greenfield), so the copy is a no-op; the rename-copy form stays
-- correct if data ever exists.
ALTER TABLE `reviews` RENAME TO `reviews_old`;--> statement-breakpoint
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
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `reviews_rating_range` CHECK (`rating` BETWEEN 1 AND 5),
	CONSTRAINT `reviews_body_len` CHECK (length(`body`) <= 300)
);--> statement-breakpoint
INSERT INTO `reviews` SELECT * FROM `reviews_old`;--> statement-breakpoint
DROP TABLE `reviews_old`;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_one_per_user_idx` ON `reviews` (`brand_id`,`product_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `reviews_product_idx` ON `reviews` (`product_id`);
