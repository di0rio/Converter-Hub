-- MySQL dump
-- Server version 8.0.35

--
-- Host: localhost    Database: store_db
--

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Database: `store_db`
--

CREATE DATABASE IF NOT EXISTS `store_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;
USE `store_db`;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
INSERT INTO `customers` VALUES
(1, 'Alice Johnson', 'alice@example.com', '2024-01-15 10:30:00'),
(2, 'Bob Smith', 'bob@example.com', '2024-02-20 14:45:00'),
(3, 'Charlie Brown', 'charlie@example.com', '2024-03-10 09:15:00'),
(4, 'Diana Prince', 'diana@example.com', '2024-04-05 16:00:00'),
(5, 'Eve Davis', 'eve@example.com', '2024-05-22 11:20:00');
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `description` text,
  `price` decimal(10,2) NOT NULL,
  `stock` int NOT NULL DEFAULT 0,
  `category` enum('electronics','clothing','food') NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
INSERT INTO `products` VALUES
(1, 'Wireless Mouse', 'Ergonomic wireless mouse with USB receiver', 29.99, 150, 'electronics', '2024-01-20 08:00:00'),
(2, 'Cotton T-Shirt', 'Soft 100% cotton t-shirt in multiple colors', 19.99, 300, 'clothing', '2024-02-15 10:30:00'),
(3, 'Organic Granola', '500g bag of organic mixed grain granola', 8.49, 500, 'food', '2024-03-01 09:00:00'),
(4, 'Bluetooth Speaker', 'Portable waterproof bluetooth speaker', 49.99, 75, 'electronics', '2024-03-18 14:00:00'),
(5, 'Denim Jacket', 'Classic fit denim jacket with brass buttons', 89.99, 120, 'clothing', '2024-04-10 11:45:00');
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `status` enum('pending','shipped','delivered') NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_id` (`customer_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
INSERT INTO `orders` VALUES
(1, 1, 29.99, 'delivered', '2024-01-25 15:30:00'),
(2, 2, 109.98, 'shipped', '2024-02-22 09:10:00'),
(3, 3, 8.49, 'pending', '2024-03-12 13:45:00'),
(4, 1, 139.97, 'delivered', '2024-04-08 10:00:00'),
(5, 4, 49.99, 'shipped', '2024-05-15 16:30:00');
UNLOCK TABLES;

--
-- Database: `blog_db`
--

CREATE DATABASE IF NOT EXISTS `blog_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;
USE `blog_db`;

--
-- Table structure for table `posts`
--

DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `author_id` int NOT NULL,
  `published` tinyint NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_published` (`published`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `posts`
--

LOCK TABLES `posts` WRITE;
INSERT INTO `posts` VALUES
(1, 'Getting Started with TypeScript', 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. In this post we explore the basics of static typing, interfaces, and generics.', 1, 1, '2024-02-01 09:00:00', '2024-02-01 09:00:00'),
(2, 'Building REST APIs with Node.js', 'REST APIs are the backbone of modern web applications. This tutorial walks through creating a clean and maintainable API using Express and TypeScript.', 1, 1, '2024-03-05 14:30:00', '2024-03-05 14:30:00'),
(3, 'Draft: Advanced Database Patterns', 'This post covers advanced database design patterns including indexing strategies, query optimization, and connection pooling for high-traffic applications.', 2, 0, '2024-04-10 11:15:00', '2024-04-10 11:15:00');
UNLOCK TABLES;

--
-- Table structure for table `comments`
--

DROP TABLE IF EXISTS `comments`;
CREATE TABLE `comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `author_name` varchar(100) NOT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_post_id` (`post_id`),
  CONSTRAINT `fk_comments_post` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `comments`
--

LOCK TABLES `comments` WRITE;
INSERT INTO `comments` VALUES
(1, 1, 'Jane Wilson', 'Great introduction! The section on generics was especially helpful.', '2024-02-03 16:20:00'),
(2, 1, 'Mike Chen', 'I wish there were more examples with enums. Otherwise very well written.', '2024-02-05 08:45:00'),
(3, 2, 'Sarah Lee', 'This is exactly what I needed for my current project. Thanks for sharing!', '2024-03-08 12:10:00');
UNLOCK TABLES;

--
-- Table structure for table `tags`
--

DROP TABLE IF EXISTS `tags`;
CREATE TABLE `tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `tags`
--

LOCK TABLES `tags` WRITE;
INSERT INTO `tags` VALUES
(1, 'typescript'),
(2, 'nodejs'),
(3, 'databases');
UNLOCK TABLES;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
