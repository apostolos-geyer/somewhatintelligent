ALTER TABLE `customer_order` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `customer_order` ADD `stripe_checkout_session_id` text;--> statement-breakpoint
ALTER TABLE `customer_order` ADD `payment_status` text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `customer_order_stripe_checkout_session_id_unique` ON `customer_order` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `idx_order_stripe_customer` ON `customer_order` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `processed_stripe_event` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` integer NOT NULL
);
