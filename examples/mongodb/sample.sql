// MongoDB seed script, as mongosh replays it.
//
// Synthetic fixture. Every name, address and value below is invented for
// testing and refers to no real person, company or account.
//
// This is the one MongoDB text format that names what it holds. mongoexport
// writes bare documents with no database or collection name attached, so a
// file of it could only be given invented names.

use shop;

db.customers.insertMany([
  { "_id": 1, "full_name": "Alice Example", "email": "alice@example.test", "tags": ["vip", "early"] },
  { "_id": 2, "full_name": "Bob Example", "email": null },
  { "_id": 3, "full_name": "Zoë Example", "email": "zoe@example.test", "address": { "city": "São Paulo" }, "note": "Prefers email; not phone." }
]);

db.orders.insertMany([
  { "_id": 100, "customer_id": 1, "description": "Widget crate", "total": 129.5, "paid": true },
  { "_id": 101, "customer_id": 2, "description": "O'Brien pattern washers", "total": 44, "paid": false }
]);

db.getCollection("audit_log").insertOne({ "_id": 1, "event": "seeded", "at": "2024-01-15T10:30:00Z" });
