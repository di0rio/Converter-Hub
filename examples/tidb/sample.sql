-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- TiDB dump produced by Dumpling, schema and data files concatenated for this
-- fixture. Dumpling writes one `<db>.<table>-schema.sql` file per table (the
-- output of SHOW CREATE TABLE, which is where the /*T![...] */ TiDB-specific
-- comments come from) and one `<db>.<table>.sql` file of plain INSERT
-- statements; Dumpling does not emit LOCK/UNLOCK TABLES or a "-- Dumpling"
-- banner comment the way mysqldump does — build metadata goes to a separate
-- `metadata` file instead.

/*!40101 SET NAMES utf8mb4*/;
/*!40014 SET FOREIGN_KEY_CHECKS=0*/;

CREATE DATABASE IF NOT EXISTS `shop_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE `shop_db`;

CREATE TABLE `customers` (
  `id` bigint(20) NOT NULL /*T![auto_rand] AUTO_RANDOM(5) */,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `signed_up_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

INSERT INTO `customers` VALUES
(1000000000000001, 'Alice Example', 'alice@example.test', '2024-01-15 10:30:00'),
(2000000000000002, 'Renée Example', NULL, '2024-02-20 14:45:00'),
(3000000000000003, 'Charlie Example', 'charlie@example.test', '2024-03-10 09:15:00');

CREATE TABLE `orders` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `customer_id` bigint(20) NOT NULL,
  `note` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] NONCLUSTERED */,
  KEY `idx_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT INTO `orders` VALUES
(1, 1000000000000001, 'Ships to depot, invoice #A-100'),
(2, 3000000000000003, NULL);
