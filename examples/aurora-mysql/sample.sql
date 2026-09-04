-- MySQL dump 10.13  Distrib 8.0.34, for Linux (x86_64)
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Host: cluster.example.test    Database: rides_db
-- ------------------------------------------------------
-- Server version	8.0.mysql_aurora.3.04.0

/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET TIME_ZONE='+00:00' */;
SET @@SESSION.aurora_replica_read_consistency = 'SESSION';

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `rides_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE `rides_db`;

DROP TABLE IF EXISTS `trips`;
CREATE TABLE `trips` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `rider` varchar(120) NOT NULL,
  `fare` decimal(8,2) DEFAULT NULL,
  `note` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `trips` WRITE;
INSERT INTO `trips` VALUES
(1,'Alice Example',12.50,'Paid; card ending in test'),
(2,'Bob Example',NULL,NULL),
(3,'Zoë Example',7.25,'São Paulo depot');
UNLOCK TABLES;

DROP TABLE IF EXISTS `vehicles`;
CREATE TABLE `vehicles` (
  `id` int NOT NULL,
  `plate` varchar(16) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `vehicles` WRITE;
INSERT INTO `vehicles` VALUES (1,'AAA-0001',1),(2,'BBB-0002',0);
UNLOCK TABLES;
