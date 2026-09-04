-- StarRocks dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Host: localhost    Database: analytics_db
-- ------------------------------------------------------
-- StarRocks writes its table shape after the column list: the storage engine,
-- the key model, and how rows are bucketed across the cluster.

CREATE DATABASE IF NOT EXISTS `analytics_db`;
USE `analytics_db`;

CREATE TABLE `page_views` (
  `id` bigint NOT NULL COMMENT "surrogate id",
  `path` varchar(200) NOT NULL COMMENT "requested path",
  `viewed_at` datetime NULL COMMENT "when",
  `country` varchar(2) NULL COMMENT "ISO code"
) ENGINE=OLAP
DUPLICATE KEY(`id`) COMMENT "raw page views"
DISTRIBUTED BY HASH(`id`) BUCKETS 4
PROPERTIES ("replication_num" = "1");

INSERT INTO `page_views` VALUES
(1,'/home','2024-01-15 10:30:00','BR'),
(2,'/pricing; plans','2024-02-20 14:45:00',NULL),
(3,'/café','2024-03-01 09:00:00','PT');

CREATE TABLE `visitors` (
  `id` int NOT NULL,
  `name` varchar(120) NOT NULL,
  `email` varchar(160) NULL
) ENGINE=OLAP
PRIMARY KEY(`id`) COMMENT "known visitors"
DISTRIBUTED BY HASH(`id`) BUCKETS 2
PROPERTIES ("replication_num" = "1");

INSERT INTO `visitors` VALUES
(1,'Alice Example','alice@example.test'),
(2,'Bob Example',NULL);
