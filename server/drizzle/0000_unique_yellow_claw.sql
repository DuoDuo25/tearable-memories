CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`edit_token` text NOT NULL,
	`ending_title` text DEFAULT '' NOT NULL,
	`ending_sub` text DEFAULT '' NOT NULL,
	`cta_label` text DEFAULT '做同款 →' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` text NOT NULL,
	`position` integer NOT NULL,
	`s3_uri` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL
);
