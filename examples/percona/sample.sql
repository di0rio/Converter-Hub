-- MySQL dump 10.13  Distrib 8.0.35-27, for Linux (x86_64)
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Host: localhost    Database: workshop_db
-- ------------------------------------------------------
-- Server version	8.0.35-27 Percona Server (GPL), Release 27
-- Storage engine: Percona XtraDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET TIME_ZONE='+00:00' */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `workshop_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE `workshop_db`;

--
-- Table structure for table `machines`
--

DROP TABLE IF EXISTS `machines`;
CREATE TABLE `machines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `serial` varchar(40) DEFAULT NULL,
  `notes` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_serial` (`serial`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `machines` WRITE;
INSERT INTO `machines` VALUES
(1,'Lathe Alpha','SN-0001','Serviced; runs quiet'),
(2,'Press Beta','SN-0002',NULL),
(3,'Grinder Gamma','SN-0003','Café-side bay — operator Zoë');
UNLOCK TABLES;

--
-- Table structure for table `operators`
--

DROP TABLE IF EXISTS `operators`;
CREATE TABLE `operators` (
  `id` int NOT NULL,
  `full_name` varchar(120) NOT NULL,
  `email` varchar(160) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `operators` WRITE;
INSERT INTO `operators` VALUES
(1,'Alice Example','alice@example.test'),
(2,'Bob Example',NULL);
UNLOCK TABLES;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
