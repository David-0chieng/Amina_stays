const Database = require('better-sqlite3');
const db = new Database('amina.db');

db.exec(`
CREATE TABLE IF NOT EXISTS guests (
  phone TEXT PRIMARY KEY, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, area TEXT, bedrooms INTEGER,
  max_guests INTEGER, price INTEGER, photo TEXT, map_link TEXT, wifi TEXT, directions TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, unit_id INTEGER, guest_phone TEXT,
  check_in TEXT, check_out TEXT, status TEXT, channel TEXT, total INTEGER,
  expires_at INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, booking_ref TEXT, amount INTEGER,
  method TEXT, status TEXT, transaction_id TEXT
);
CREATE TABLE IF NOT EXISTS access_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, booking_ref TEXT, code TEXT,
  issued_at TEXT, invalidated_at TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY, state TEXT DEFAULT 'idle', data TEXT DEFAULT '{}', updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, check_in TEXT, check_out TEXT, area TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, text TEXT, direction TEXT, handled TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// add a column to an existing table if it isn't there yet (keeps old amina.db files working)
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('payments', 'checkout_token', 'TEXT');
addColumn('payments', 'created_at', 'TEXT');
addColumn('units', 'tips', 'TEXT');
addColumn('guests', 'last_area', 'TEXT');
addColumn('guests', 'last_guests', 'INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, booking_ref TEXT UNIQUE, phone TEXT, rating INTEGER, comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

// seed demo units once
if (db.prepare('SELECT COUNT(*) c FROM units').get().c === 0) {
  const ins = db.prepare(`INSERT INTO units (name,area,bedrooms,max_guests,price,photo,map_link,wifi,directions)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run('Nyali Breeze Studio','Nyali',1,2,4500,'/img/nyali1.jpg','https://maps.google.com/?q=Nyali+Mombasa','NyaliBreeze / pass: swahili123','Behind City Mall, blue gate');
  ins.run('Blue Reef Apartment','Nyali',2,4,6000,'/img/nyali2.jpg','https://maps.google.com/?q=Nyali+Mombasa','BlueReef / pass: reef2026','Next to Nyali Bridge, 3rd floor');
  ins.run('Diani Palm Suite','Diani',2,4,7500,'/img/diani1.jpg','https://maps.google.com/?q=Diani+Beach','DianiPalm / pass: palm4321','Diani Beach Rd, opposite Sands Hotel');
  ins.run('Old Town Loft','Old Town',1,2,3800,'/img/old1.jpg','https://maps.google.com/?q=Old+Town+Mombasa','OldTown / pass: loft7788','Near Fort Jesus, green door');
}

// default local tips per area (Amina can edit units.tips directly)
const TIPS = {
  'Nyali': 'Food: City Mall & Nyali Centre have cafes and a supermarket close by. Beach: Nyali public beach is a short ride away.',
  'Diani': 'Food: plenty of beach restaurants along Diani Beach Rd. Beach: swim at high tide; only buy excursions from licensed operators.',
  'Old Town': 'Food: try mahamri and viazi karai from the street stalls. Sights: Fort Jesus is a short walk; take a guide for the narrow lanes after dark.'
};
for (const [area, tip] of Object.entries(TIPS))
  db.prepare('UPDATE units SET tips=? WHERE area=? AND tips IS NULL').run(tip, area);

module.exports = db;