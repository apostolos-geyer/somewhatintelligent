PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customer_order` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ship_name` text,
	`ship_line1` text,
	`ship_line2` text,
	`ship_city` text,
	`ship_region` text,
	`ship_postal` text,
	`ship_country` text DEFAULT 'CA' NOT NULL,
	`ship_phone` text,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`stripe_customer_id` text,
	`stripe_checkout_session_id` text,
	`stripe_session_expires_at` integer,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`carrier` text,
	`tracking_number` text,
	`fulfillment_note` text,
	`shipped_at` integer,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ship_address_atomic" CHECK((ship_name IS NULL) = (ship_line1 IS NULL) AND (ship_name IS NULL) = (ship_city IS NULL) AND (ship_name IS NULL) = (ship_region IS NULL) AND (ship_name IS NULL) = (ship_postal IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_customer_order`("id", "order_number", "user_id", "email", "status", "ship_name", "ship_line1", "ship_line2", "ship_city", "ship_region", "ship_postal", "ship_country", "ship_phone", "subtotal_cents", "shipping_cents", "total_cents", "stripe_customer_id", "stripe_checkout_session_id", "stripe_session_expires_at", "payment_status", "carrier", "tracking_number", "fulfillment_note", "shipped_at", "delivered_at", "created_at", "updated_at") SELECT "id", "order_number", "user_id", "email", "status", "ship_name", "ship_line1", "ship_line2", "ship_city", "ship_region", "ship_postal", "ship_country", "ship_phone", "subtotal_cents", "shipping_cents", "total_cents", "stripe_customer_id", "stripe_checkout_session_id", "stripe_session_expires_at", "payment_status", "carrier", "tracking_number", "fulfillment_note", "shipped_at", "delivered_at", "created_at", "updated_at" FROM `customer_order`;--> statement-breakpoint
DROP TABLE `customer_order`;--> statement-breakpoint
ALTER TABLE `__new_customer_order` RENAME TO `customer_order`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `customer_order_order_number_unique` ON `customer_order` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_order_stripe_checkout_session_id_unique` ON `customer_order` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `idx_order_user` ON `customer_order` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_order_status` ON `customer_order` (`status`);--> statement-breakpoint
CREATE INDEX `idx_order_stripe_customer` ON `customer_order` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `__new_product_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`size` text NOT NULL,
	`sku` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stock_non_negative" CHECK(stock >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_product_variant`("id", "product_id", "size", "sku", "stock", "created_at") SELECT "id", "product_id", "size", "sku", "stock", "created_at" FROM `product_variant`;--> statement-breakpoint
DROP TABLE `product_variant`;--> statement-breakpoint
ALTER TABLE `__new_product_variant` RENAME TO `product_variant`;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variant_sku_unique` ON `product_variant` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_variant_product` ON `product_variant` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_variant_product_size` ON `product_variant` (`product_id`,`size`);