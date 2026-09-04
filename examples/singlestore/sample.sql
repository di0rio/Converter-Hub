-- SingleStore dump (formerly MemSQL)
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Host: localhost    Database: events_db
-- ------------------------------------------------------

/*!40101 SET NAMES utf8mb4 */;

CREATE DATABASE IF NOT EXISTS `events_db`;
USE `events_db`;

--
-- A SingleStore table declares how rows are spread across the cluster inside
-- the CREATE TABLE, alongside the columns.
--

CREATE TABLE `events` (
  `id` bigint NOT NULL,
  `kind` varchar(40) NOT NULL,
  `payload` text,
  `sort` int DEFAULT NULL,
  SHARD KEY (`id`),
  SORT KEY (`id`)
);

INSERT INTO `events` VALUES
(1,'signup','{"ok":true}',10),
(2,'purchase',NULL,20),
(3,'refund','note; with semicolon',NULL);

CREATE TABLE `actors` (
  `id` int NOT NULL,
  `name` varchar(120) NOT NULL,
  `email` varchar(160) DEFAULT NULL,
  SHARD KEY (`id`)
);

INSERT INTO `actors` VALUES
(1,'Alice Example','alice@example.test'),
(2,'Zoë Example',NULL);
