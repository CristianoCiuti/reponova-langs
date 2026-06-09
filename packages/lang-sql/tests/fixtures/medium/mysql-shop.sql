-- A typical MySQL e-commerce schema demonstrating backticks, AUTO_INCREMENT,
-- ENGINE clauses, multi-column foreign keys, and a stored procedure.
-- This is the MySQL prong of the medium-tier fixture.

CREATE TABLE `categories` (
  `id`         INT(11) NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100) NOT NULL,
  `parent_id`  INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_categories_parent` (`parent_id`),
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `customers` (
  `id`         INT(11) NOT NULL AUTO_INCREMENT,
  `email`      VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `products` (
  `id`           INT(11) NOT NULL AUTO_INCREMENT,
  `category_id`  INT(11) NOT NULL,
  `sku`          VARCHAR(64) NOT NULL,
  `name`         VARCHAR(255) NOT NULL,
  `price_cents`  INT(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_sku` (`sku`),
  KEY `idx_products_category` (`category_id`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `orders` (
  `id`           INT(11) NOT NULL AUTO_INCREMENT,
  `customer_id`  INT(11) NOT NULL,
  `placed_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`       ENUM('pending','paid','shipped','cancelled') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (`id`),
  KEY `idx_orders_customer` (`customer_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `order_items` (
  `order_id`    INT(11) NOT NULL,
  `product_id`  INT(11) NOT NULL,
  `quantity`    INT(11) NOT NULL DEFAULT 1,
  `unit_price`  INT(11) NOT NULL,
  PRIMARY KEY (`order_id`, `product_id`),
  KEY `idx_order_items_product` (`product_id`),
  CONSTRAINT `fk_order_items_order`   FOREIGN KEY (`order_id`)   REFERENCES `orders`  (`id`),
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX `idx_orders_status` ON `orders` (`status`);

CREATE VIEW `v_customer_orders` AS
SELECT c.id            AS customer_id,
       c.email,
       o.id            AS order_id,
       o.status,
       o.placed_at
FROM   customers c
JOIN   orders    o ON c.id = o.customer_id;

CREATE PROCEDURE `cleanup_cancelled_orders`()
BEGIN
  DELETE FROM orders WHERE status = 'cancelled' AND placed_at < NOW() - INTERVAL 30 DAY;
END;
