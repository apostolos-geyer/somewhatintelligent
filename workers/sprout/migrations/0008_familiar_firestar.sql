ALTER TABLE `products` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `wholesale_url` text;--> statement-breakpoint
ALTER TABLE `products` ADD `province` text;