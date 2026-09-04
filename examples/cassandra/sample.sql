-- Cassandra CQL script
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Produced by `cqlsh -e "DESCRIBE KEYSPACE shop"` plus INSERT statements.
-- Cassandra's own bulk path is COPY TO / COPY FROM against CSV files, which is
-- not a SQL script; what is read here is the CQL script form.

CREATE KEYSPACE IF NOT EXISTS shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE shop;

CREATE TABLE shop.customers (
    id uuid,
    full_name text,
    email text,
    tags map<text, int>,
    aliases frozen<list<text>>,
    signed_up timestamp,
    PRIMARY KEY (id)
);

INSERT INTO shop.customers (id, full_name, email, tags, signed_up) VALUES (11111111-1111-1111-1111-111111111111, 'Alice Example', 'alice@example.test', {'vip': 1}, '2024-01-15 10:30:00');
INSERT INTO shop.customers (id, full_name, email, tags, signed_up) VALUES (22222222-2222-2222-2222-222222222222, 'Bob Example', null, null, '2024-02-20 14:45:00');
INSERT INTO shop.customers (id, full_name, email, tags, signed_up) VALUES (33333333-3333-3333-3333-333333333333, 'Zoë Example', 'zoe@example.test', {'note': 2}, '2024-03-01 09:00:00');

CREATE INDEX customers_email_idx ON shop.customers (email);

CREATE TABLE shop.orders (
    id uuid,
    customer_id uuid,
    description text,
    total decimal,
    PRIMARY KEY (id)
);

INSERT INTO shop.orders (id, customer_id, description, total) VALUES (44444444-4444-4444-4444-444444444444, 11111111-1111-1111-1111-111111111111, 'Widget crate; packed', 129.50);
INSERT INTO shop.orders (id, customer_id, description, total) VALUES (55555555-5555-5555-5555-555555555555, 22222222-2222-2222-2222-222222222222, 'O''Brien pattern washers', 44.00);
