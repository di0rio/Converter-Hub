// Neo4j Cypher script
//
// Synthetic fixture. Every name, address and value below is invented for
// testing and refers to no real person, company or account.
//
// Only the nodes below are extracted. The relationships are counted and
// reported, never turned into a table.

CREATE (a:Person {id: 1, name: 'Alice Example', email: 'alice@example.test', city: 'São Paulo'});
CREATE (b:Person {id: 2, name: 'Bob Example', email: null});
CREATE (c:Person {id: 3, name: "Zoë Example", note: 'Prefers email; not phone.', tags: ['vip', 'early']});

CREATE (w:Product {id: 100, title: 'Widget crate', price: 129.5, in_stock: true});
CREATE (p:Product {id: 101, title: "O'Brien pattern washers", price: 44, in_stock: false});

MATCH (a:Person {id: 1}), (w:Product {id: 100})
CREATE (a)-[:BOUGHT {at: '2024-01-15'}]->(w);

MATCH (b:Person {id: 2}), (p:Product {id: 101})
CREATE (b)-[:BOUGHT {at: '2024-02-20'}]->(p);
