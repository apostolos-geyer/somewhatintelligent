CREATE TABLE `dead_stripe_event` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`object_id` text,
	`metadata_order_id` text,
	`payload` text NOT NULL,
	`attempts` integer,
	`reason` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer
);
