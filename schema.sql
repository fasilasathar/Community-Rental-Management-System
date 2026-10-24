-- MySQL 8.0.16+ (uses expression defaults and CHECK constraints)
CREATE DATABASE IF NOT EXISTS rental CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rental;

CREATE TABLE IF NOT EXISTS members (
  member_id     INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  address       VARCHAR(255) NOT NULL,
  phone         VARCHAR(20)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  upi_id        VARCHAR(100) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  item_id     INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  category_id INT NOT NULL,
  owner_id    INT NOT NULL,
  daily_rate  DECIMAL(10,2) NOT NULL,
  deposit     DECIMAL(10,2) NOT NULL DEFAULT 0,
  status      ENUM('available','rented') NOT NULL DEFAULT 'available',
  image       VARCHAR(255) NULL,
  CONSTRAINT chk_items_rate    CHECK (daily_rate > 0),
  CONSTRAINT chk_items_deposit CHECK (deposit >= 0),
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(category_id),
  CONSTRAINT fk_items_owner    FOREIGN KEY (owner_id)    REFERENCES members(member_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rentals (
  rental_id     INT AUTO_INCREMENT PRIMARY KEY,
  item_id       INT NOT NULL,
  renter_id     INT NOT NULL,
  start_date    DATE NOT NULL DEFAULT (CURDATE()),
  due_date      DATE NOT NULL,
  return_date   DATE NULL,
  total_amount  DECIMAL(10,2) NULL,
  payment_mode  ENUM('cash','upi','card','netbanking') NOT NULL DEFAULT 'cash',
  CONSTRAINT fk_rentals_item   FOREIGN KEY (item_id)   REFERENCES items(item_id),
  CONSTRAINT fk_rentals_renter FOREIGN KEY (renter_id) REFERENCES members(member_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  rental_id  INT NOT NULL,
  type       ENUM('deposit','rent','late_fee','damage','refund') NOT NULL,
  amount     DECIMAL(10,2) NOT NULL,
  paid_on    DATE NOT NULL DEFAULT (CURDATE()),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0),
  CONSTRAINT fk_payments_rental  FOREIGN KEY (rental_id) REFERENCES rentals(rental_id)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW overdue_rentals AS
  SELECT r.rental_id, i.name AS item, m.name AS renter, r.due_date
  FROM rentals r
  JOIN items i   ON i.item_id   = r.item_id
  JOIN members m ON m.member_id = r.renter_id
  WHERE r.return_date IS NULL AND r.due_date < CURDATE();

INSERT IGNORE INTO categories(name) VALUES
  ('Tools'),('Furniture'),('Appliances'),('Sports'),('Party'),('Textbooks'),('Calculators'),
  ('Lab Equipment'),('Stationery & Art'),('Laptops & Electronics'),('Bicycles'),('Musical Instruments'),
  ('Hostel Essentials'),('Study Materials'),('Project Kits'),('Gardening'),('Camping & Trekking'),
  ('Cameras & Photography'),('Gaming'),('Kitchenware'),('Cleaning Equipment'),('Power Tools'),
  ('Ladders & Scaffolding'),('Books & Novels'),('Exam Prep Material'),('Drawing & Architecture Kits'),
  ('Medical & First Aid'),('Fitness Equipment'),('Kids'' Toys'),('Baby Gear'),('Costumes & Fancy Dress'),
  ('Event Decor'),('Sound & Lighting'),('Projectors & Screens'),('Chairs & Tables'),('Tents & Canopies'),
  ('Cooking Appliances'),('Fans & Coolers'),('Heaters & Geysers'),('Luggage & Travel'),('Scooters & Bikes'),
  ('Car Accessories'),('Helmets & Safety Gear'),('Sewing & Craft'),('Art Supplies'),('Electronics Components'),
  ('Networking & Wi-Fi'),('Printers & Scanners'),('Mobile Accessories'),('Board Games'),
  ('Sports Kits (Cricket, Football)'),('Badminton & Table Tennis'),('Swimming & Water Sports'),
  ('Fishing & Outdoor'),('Language Learning'),('Software Licenses'),('Laundry'),('Storage & Boxes'),
  ('Wedding Items'),('Festival Items'),('Other');