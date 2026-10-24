import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME || 'rental',
};

// ---- create the database + tables if they do not exist yet ----
try {
  const boot = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, multipleStatements: true });
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await boot.query(`USE \`${DB.database}\``);
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, ''); // db name comes from DB_NAME instead
  await boot.query(schema);
  await boot.end();
} catch (e) {
  console.error('\nCould not set up MySQL:', e.message);
  console.error('Check DB_HOST / DB_USER / DB_PASSWORD in server/.env and that MySQL is running.\n');
  process.exit(1);
}

const pool = mysql.createPool({
  ...DB, waitForConnections: true, connectionLimit: 10,
  dateStrings: true, // DATE columns come back as 'YYYY-MM-DD' text, like before
  typeCast: (field, next) => { // DECIMAL columns come back as numbers, not strings
    if (field.type === 'NEWDECIMAL') { const v = field.string(); return v === null ? null : Number(v); }
    return next();
  },
});

// q = run a query (rows for SELECT, result info for INSERT/UPDATE/DELETE); one = first row; tx = transaction
const q = async (sql, params = [], c = pool) => (await c.query(sql, params))[0];
const one = async (sql, params = [], c = pool) => (await q(sql, params, c))[0];
const tx = async fn => {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const out = await fn(c); await c.commit(); return out; }
  catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
};

const MODES = ['cash', 'upi', 'card', 'netbanking'];
// real calendar date in YYYY-MM-DD form (rejects 2026-02-31, "tomorrow", empty text ...)
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
// turns form text into a number, or throws a readable message
const amountOf = (v, label, { required = true, positive = false } = {}) => {
  if ((v === undefined || v === null || String(v).trim() === '') && !required) return 0;
  const n = Number(v);
  if (String(v ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || (positive && n === 0)) throw new Error(`Enter a valid ${label}`);
  return n;
};
const validUpi = v => !v || /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v);
const app = express();
app.use(cors(), express.json());

// ---- image uploads ----
const uploadDir = fileURLToPath(new URL('./uploads/', import.meta.url));
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});
const removeImage = p => { if (p) fs.unlink(path.join(uploadDir, path.basename(p)), () => {}); };

// turn MySQL errors into messages a person can read
const friendly = e => {
  switch (e.code) {
    case 'ER_DUP_ENTRY': return /phone/i.test(e.sqlMessage || '') ? 'That phone number is already registered' : 'That value already exists';
    case 'ER_CHECK_CONSTRAINT_VIOLATED': return 'Please check the amounts you entered';
    case 'ER_NO_REFERENCED_ROW_2': return 'The selected record does not exist';
    case 'ER_ROW_IS_REFERENCED_2': return 'This record is still in use and cannot be removed';
    case 'ER_DATA_TOO_LONG': return 'One of the values is too long';
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD': return 'Please enter a valid date or number';
    default: return e.message;
  }
};
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 400).json({ error: friendly(e) }); }
};
const sign = m => ({ token: jwt.sign({ id: m.member_id, name: m.name }, SECRET, { expiresIn: '8h' }),
  user: { id: m.member_id, name: m.name } });

// ---------- auth (public) ----------
app.post('/api/auth/register', wrap(async ({ body: b }) => {
  if (!b.name || !b.address || !b.phone || !b.password) throw new Error('All fields required');
  if (b.name.trim().toLowerCase() === ADMIN_USER) throw new Error('That name is not available');
  if (b.password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!validUpi(b.upi_id)) throw new Error('Enter a valid UPI ID like name@okaxis');
  const r = await q('INSERT INTO members(name,address,phone,password_hash,upi_id) VALUES (?,?,?,?,?)',
    [b.name, b.address, b.phone, bcrypt.hashSync(b.password, 10), b.upi_id || null]);
  return sign({ member_id: r.insertId, name: b.name });
}));
app.post('/api/auth/login', wrap(async ({ body: b }) => {
  const id = (b.phone || '').trim();
  if (id.toLowerCase() === ADMIN_USER && b.password === ADMIN_PASS) {
    const user = { id: 0, name: 'Admin', admin: true };
    return { token: jwt.sign(user, SECRET, { expiresIn: '8h' }), user };
  }
  const matches = await q('SELECT * FROM members WHERE phone=? OR LOWER(name)=LOWER(?)', [id, id]);
  const m = matches.find(x => bcrypt.compareSync(b.password || '', x.password_hash));
  if (!m) throw Object.assign(new Error('Invalid name/phone or password'), { status: 401 });
  return sign(m);
}));

// ---------- everything below needs a valid token ----------
app.use('/api', (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    const isAdminRoute = req.path.startsWith('/admin/');
    if (isAdminRoute && !req.user.admin) return res.status(403).json({ error: 'Admins only' });
    if (req.user.admin && req.method !== 'GET' && !isAdminRoute)
      return res.status(403).json({ error: 'Use the admin tools to make changes' });
    next();
  }
  catch { res.status(401).json({ error: 'Please log in' }); }
});

app.get('/api/categories', wrap(() => q('SELECT * FROM categories ORDER BY name')));
app.get('/api/members', wrap(({ user }) => q(
  `SELECT member_id,name,address,phone, CASE WHEN member_id=? OR ?=1 THEN upi_id END AS upi_id FROM members ORDER BY name`,
  [user.id, user.admin ? 1 : 0])));

app.get('/api/items', wrap(() => q(`
  SELECT i.*, c.name AS category, m.name AS owner FROM items i
  JOIN categories c ON c.category_id = i.category_id JOIN members m ON m.member_id = i.owner_id
  ORDER BY i.name`)));
app.post('/api/items', upload.single('image'), wrap(async ({ body: b, user, file }) => {
  const r = await q('INSERT INTO items(name,category_id,owner_id,daily_rate,deposit,image) VALUES (?,?,?,?,?,?)',
    [b.name, b.category_id, user.id, amountOf(b.daily_rate, 'daily rate', { positive: true }), amountOf(b.deposit, 'deposit', { required: false }), file ? '/uploads/' + file.filename : null]);
  return { item_id: r.insertId };
}));

app.get('/api/rentals', wrap(() => q(`
  SELECT r.*, i.name AS item, i.owner_id, m.name AS renter, o.name AS owner,
    (r.return_date IS NULL AND r.due_date < CURDATE()) AS overdue
  FROM rentals r JOIN items i ON i.item_id = r.item_id JOIN members m ON m.member_id = r.renter_id
  JOIN members o ON o.member_id = i.owner_id
  ORDER BY r.rental_id DESC`)));

app.post('/api/rentals', wrap(({ body: b, user }) => tx(async c => {
  if (!validDate(b.due_date)) throw new Error('Choose a valid due date');
  const item = await one('SELECT * FROM items WHERE item_id=? FOR UPDATE', [b.item_id], c); // lock: no double-renting
  if (b.due_date < (await one('SELECT CURDATE() AS d', [], c)).d) throw new Error('Due date cannot be in the past');
  if (!item) throw new Error('Item not found');
  if (item.status !== 'available') throw new Error('Item is already rented');
  if (item.owner_id === user.id) throw new Error('You cannot rent your own item');
  const mode = b.payment_mode || 'cash';
  if (!MODES.includes(mode)) throw new Error('Invalid payment mode');
  const r = await q('INSERT INTO rentals(item_id,renter_id,due_date,payment_mode) VALUES (?,?,?,?)',
    [b.item_id, user.id, b.due_date, mode], c);
  await q("UPDATE items SET status='rented' WHERE item_id=?", [b.item_id], c);
  if (item.deposit > 0)
    await q("INSERT INTO payments(rental_id,type,amount) VALUES (?, 'deposit', ?)", [r.insertId, item.deposit], c);
  return { rental_id: r.insertId };
})));

const LATE_FEE_RATE = 0.5; // late fee per overdue day = 50% of the daily rate

// actorId = null means admin (no ownership checks)
const closeRental = (id, damage, actorId) => tx(async c => {
  const r = await one(`SELECT r.*, i.daily_rate, i.deposit, i.owner_id FROM rentals r JOIN items i ON i.item_id = r.item_id
    WHERE r.rental_id=? AND r.return_date IS NULL FOR UPDATE`, [id], c);
  if (!r) throw new Error('Active rental not found');
  if (actorId !== null && actorId !== r.renter_id && actorId !== r.owner_id) throw new Error('Only the renter or owner can return this');
  if (damage < 0) throw new Error('Damage charge cannot be negative');
  if (damage > 0 && actorId !== null && actorId !== r.owner_id) throw new Error('Only the item owner can add a damage charge');
  const { today } = await one('SELECT CURDATE() AS today', [], c);
  const days = Math.max(1, Math.ceil((Date.now() - new Date(r.start_date)) / 86400000));
  const total = days * r.daily_rate;
  const lateDays = Math.max(0, Math.round((new Date(today) - new Date(r.due_date)) / 86400000));
  const lateFee = lateDays * r.daily_rate * LATE_FEE_RATE;
  const refund = Math.max(0, r.deposit - lateFee - damage);
  const pay = (type, amount) => q('INSERT INTO payments(rental_id,type,amount) VALUES (?,?,?)', [id, type, amount], c);
  await q('UPDATE rentals SET return_date=CURDATE(), total_amount=? WHERE rental_id=?', [total, id], c);
  await q("UPDATE items SET status='available' WHERE item_id=?", [r.item_id], c);
  await pay('rent', total);
  if (lateFee > 0) await pay('late_fee', lateFee);
  if (damage > 0) await pay('damage', damage);
  if (refund > 0) await pay('refund', refund);
  return { total, lateFee, damage, refunded: refund };
});

app.post('/api/rentals/:id/return', wrap(({ params, body, user }) =>
  closeRental(params.id, Number(body?.damage) || 0, user.id)));

// payments the logged-in member made (as renter) or received (as owner); admin sees all
app.get('/api/payments', wrap(({ user }) => q(`
  SELECT p.*, r.payment_mode AS mode, i.name AS item, r.renter_id, i.owner_id, m.name AS renter, o.name AS owner,
         m.upi_id AS renter_upi, o.upi_id AS owner_upi
  FROM payments p JOIN rentals r ON r.rental_id = p.rental_id JOIN items i ON i.item_id = r.item_id
  JOIN members m ON m.member_id = r.renter_id JOIN members o ON o.member_id = i.owner_id
  WHERE ?=1 OR r.renter_id = ? OR i.owner_id = ? ORDER BY p.payment_id DESC`,
  [user.admin ? 1 : 0, user.id, user.id])));

// ---- edit / delete ----
const ownItem = async (id, user) => {
  const it = await one('SELECT * FROM items WHERE item_id=?', [id]);
  if (!it) throw new Error('Item not found');
  if (it.owner_id !== user.id) throw Object.assign(new Error('You can only change your own items'), { status: 403 });
  return it;
};
app.put('/api/items/:id', upload.single('image'), wrap(async ({ params, body: b, user, file }) => {
  const it = await ownItem(params.id, user);
  if (it.status === 'rented') throw new Error('Cannot edit an item while it is rented out');
  if (file) removeImage(it.image);
  await q('UPDATE items SET name=?, category_id=?, daily_rate=?, deposit=?, image=? WHERE item_id=?',
    [b.name, b.category_id, amountOf(b.daily_rate, 'daily rate', { positive: true }), amountOf(b.deposit, 'deposit', { required: false }), file ? '/uploads/' + file.filename : it.image, params.id]);
  return { updated: true };
}));
app.delete('/api/items/:id', wrap(async ({ params, user }) => {
  const it = await ownItem(params.id, user);
  if (await one('SELECT 1 AS x FROM rentals WHERE item_id=? LIMIT 1', [params.id]))
    throw new Error('This item has rental history and cannot be deleted');
  removeImage(it.image);
  await q('DELETE FROM items WHERE item_id=?', [params.id]);
  return { deleted: true };
}));
app.put('/api/members/me', wrap(async ({ body: b, user }) => {
  if (!b.name || !b.address || !b.phone) throw new Error('Name, address and phone are required');
  if (!validUpi(b.upi_id)) throw new Error('Enter a valid UPI ID like name@okaxis');
  if (b.password && b.password.length < 6) throw new Error('Password must be at least 6 characters');
  await q('UPDATE members SET name=?, address=?, phone=?, upi_id=? WHERE member_id=?',
    [b.name, b.address, b.phone, b.upi_id || null, user.id]);
  if (b.password) await q('UPDATE members SET password_hash=? WHERE member_id=?', [bcrypt.hashSync(b.password, 10), user.id]);
  return { name: b.name };
}));
app.delete('/api/members/me', wrap(async ({ user }) => {
  if (await one('SELECT 1 AS x FROM items WHERE owner_id=? LIMIT 1', [user.id]) ||
      await one('SELECT 1 AS x FROM rentals WHERE renter_id=? LIMIT 1', [user.id]))
    throw new Error('Remove your items and finish your rentals first; accounts with history cannot be deleted');
  await q('DELETE FROM members WHERE member_id=?', [user.id]);
  return { deleted: true };
}));

// ---- rentals: edit / delete ----
const myRental = async (id, user) => {
  const r = await one('SELECT r.*, i.owner_id FROM rentals r JOIN items i ON i.item_id = r.item_id WHERE r.rental_id=?', [id]);
  if (!r) throw new Error('Rental not found');
  if (user.id !== r.renter_id && user.id !== r.owner_id)
    throw Object.assign(new Error('Only the renter or owner can change this rental'), { status: 403 });
  return r;
};
app.put('/api/rentals/:id', wrap(async ({ params, body: b, user }) => {
  const r = await myRental(params.id, user);
  if (r.return_date) throw new Error('Returned rentals cannot be edited');
  if (!validDate(b.due_date) || b.due_date < r.start_date)
    throw new Error('Enter a valid due date that is not before the start date');
  await q('UPDATE rentals SET due_date=? WHERE rental_id=?', [b.due_date, params.id]);
  return { updated: true };
}));
app.delete('/api/rentals/:id', wrap(async ({ params, user }) => {
  await myRental(params.id, user);
  await tx(c => dropRental(c, params.id));
  return { deleted: true };
}));

app.get('/api/stats', wrap(() => one(`SELECT
  (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM items) AS items,
  (SELECT COUNT(*) FROM rentals WHERE return_date IS NULL) AS active,
  (SELECT COUNT(*) FROM overdue_rentals) AS overdue,
  (SELECT IFNULL(SUM(amount),0) FROM payments WHERE type IN ('rent','late_fee','damage')) AS revenue`)));

// ---------- admin (only reachable with an admin token, see middleware above) ----------
const count = async sql => Number((await one(sql)).n);
const sumPay = async where => Number((await one(`SELECT IFNULL(SUM(amount),0) AS n FROM payments WHERE ${where}`)).n);

// the helpers below take the transaction connection `c`
const dropRental = async (c, id) => {
  const r = await one('SELECT * FROM rentals WHERE rental_id=?', [id], c);
  if (!r) return;
  await q('DELETE FROM payments WHERE rental_id=?', [id], c);
  await q('DELETE FROM rentals WHERE rental_id=?', [id], c);
  if (!r.return_date) await q("UPDATE items SET status='available' WHERE item_id=?", [r.item_id], c);
};
const dropItem = async (c, id) => {
  const it = await one('SELECT * FROM items WHERE item_id=?', [id], c);
  if (!it) return;
  for (const r of await q('SELECT rental_id FROM rentals WHERE item_id=?', [id], c)) await dropRental(c, r.rental_id);
  await q('DELETE FROM items WHERE item_id=?', [id], c);
  removeImage(it.image);
};

app.get('/api/admin/overview', wrap(async () => ({
  totals: {
    members: await count('SELECT COUNT(*) AS n FROM members'),
    items: await count('SELECT COUNT(*) AS n FROM items'),
    available: await count("SELECT COUNT(*) AS n FROM items WHERE status='available'"),
    active: await count('SELECT COUNT(*) AS n FROM rentals WHERE return_date IS NULL'),
    overdue: await count('SELECT COUNT(*) AS n FROM overdue_rentals'),
    rentals: await count('SELECT COUNT(*) AS n FROM rentals'),
    rent: await sumPay("type='rent'"),
    late_fees: await sumPay("type='late_fee'"),
    damage: await sumPay("type='damage'"),
    deposits_held: await count(`SELECT IFNULL(SUM(p.amount),0) AS n FROM payments p JOIN rentals r ON r.rental_id = p.rental_id
      WHERE p.type='deposit' AND r.return_date IS NULL`),
  },
  monthly: (await q(`SELECT DATE_FORMAT(paid_on,'%Y-%m') AS \`month\`, SUM(amount) AS total FROM payments
    WHERE type IN ('rent','late_fee','damage') GROUP BY \`month\` ORDER BY \`month\` DESC LIMIT 6`)).reverse(),
  topItems: await q(`SELECT i.name, COUNT(*) AS n FROM rentals r JOIN items i ON i.item_id = r.item_id
    GROUP BY i.item_id, i.name ORDER BY n DESC, i.name LIMIT 5`),
  topMembers: await q(`SELECT m.name, COUNT(*) AS n FROM rentals r JOIN members m ON m.member_id = r.renter_id
    GROUP BY m.member_id, m.name ORDER BY n DESC, m.name LIMIT 5`),
  overdueList: await q('SELECT * FROM overdue_rentals ORDER BY due_date'),
})));

app.get('/api/admin/members', wrap(() => q(`
  SELECT m.member_id, m.name, m.address, m.phone, m.upi_id,
    (SELECT COUNT(*) FROM items WHERE owner_id = m.member_id) AS items,
    (SELECT COUNT(*) FROM rentals WHERE renter_id = m.member_id) AS rentals,
    (SELECT COUNT(*) FROM rentals WHERE renter_id = m.member_id AND return_date IS NULL) AS active
  FROM members m ORDER BY m.name`)));

app.put('/api/admin/members/:id/password', wrap(async ({ params, body: b }) => {
  if (!b.password || b.password.length < 6) throw new Error('Password must be at least 6 characters');
  const r = await q('UPDATE members SET password_hash=? WHERE member_id=?', [bcrypt.hashSync(b.password, 10), params.id]);
  if (!r.affectedRows) throw new Error('Member not found');
  return { ok: true };
}));

app.delete('/api/admin/members/:id', wrap(({ params }) => tx(async c => {
  if (!await one('SELECT 1 AS x FROM members WHERE member_id=?', [params.id], c)) throw new Error('Member not found');
  for (const i of await q('SELECT item_id FROM items WHERE owner_id=?', [params.id], c)) await dropItem(c, i.item_id);
  for (const r of await q('SELECT rental_id FROM rentals WHERE renter_id=?', [params.id], c)) await dropRental(c, r.rental_id);
  await q('DELETE FROM members WHERE member_id=?', [params.id], c);
  return { deleted: true };
})));

// admin can add / edit items and change their photo, just like members do
const dropUpload = file => { if (file) removeImage('/uploads/' + file.filename); }; // clean up if the save fails
app.post('/api/admin/items', upload.single('image'), wrap(async ({ body: b, file }) => {
  try {
    if (!b.name?.trim()) throw new Error('Item name required');
    if (!await one('SELECT 1 AS x FROM members WHERE member_id=?', [b.owner_id])) throw new Error('Choose the member who owns this item');
    const r = await q('INSERT INTO items(name,category_id,owner_id,daily_rate,deposit,image) VALUES (?,?,?,?,?,?)',
      [b.name.trim(), b.category_id, b.owner_id, amountOf(b.daily_rate, 'daily rate', { positive: true }), amountOf(b.deposit, 'deposit', { required: false }), file ? '/uploads/' + file.filename : null]);
    return { item_id: r.insertId };
  } catch (e) { dropUpload(file); throw e; }
}));
app.put('/api/admin/items/:id', upload.single('image'), wrap(async ({ params, body: b, file }) => {
  try {
    const it = await one('SELECT * FROM items WHERE item_id=?', [params.id]);
    if (!it) throw new Error('Item not found');
    if (!b.name?.trim()) throw new Error('Item name required');
    if (it.status === 'rented' && (Number(b.daily_rate) !== Number(it.daily_rate) || Number(b.deposit || 0) !== Number(it.deposit)))
      throw new Error('Rate and deposit cannot change while the item is rented out');
    let image = it.image;
    if (file) image = '/uploads/' + file.filename;
    else if (b.remove_image === '1') image = null;
    await q('UPDATE items SET name=?, category_id=?, daily_rate=?, deposit=?, image=? WHERE item_id=?',
      [b.name.trim(), b.category_id, amountOf(b.daily_rate, 'daily rate', { positive: true }), amountOf(b.deposit, 'deposit', { required: false }), image, params.id]);
    if (image !== it.image) removeImage(it.image); // old photo is no longer used
    return { updated: true };
  } catch (e) { dropUpload(file); throw e; }
}));
app.delete('/api/admin/items/:id', wrap(({ params }) => tx(async c => {
  if (!await one('SELECT 1 AS x FROM items WHERE item_id=?', [params.id], c)) throw new Error('Item not found');
  await dropItem(c, params.id);
  return { deleted: true };
})));

app.put('/api/admin/rentals/:id', wrap(async ({ params, body: b }) => {
  const r = await one('SELECT * FROM rentals WHERE rental_id=?', [params.id]);
  if (!r) throw new Error('Rental not found');
  if (r.return_date) throw new Error('Returned rentals cannot be edited');
  if (!validDate(b.due_date) || b.due_date < r.start_date)
    throw new Error('Enter a valid due date that is not before the start date');
  await q('UPDATE rentals SET due_date=? WHERE rental_id=?', [b.due_date, params.id]);
  return { updated: true };
}));
app.post('/api/admin/rentals/:id/return', wrap(({ params, body }) =>
  closeRental(params.id, Number(body?.damage) || 0, null)));
app.delete('/api/admin/rentals/:id', wrap(({ params }) => tx(async c => {
  if (!await one('SELECT 1 AS x FROM rentals WHERE rental_id=?', [params.id], c)) throw new Error('Rental not found');
  await dropRental(c, params.id);
  return { deleted: true };
})));

app.post('/api/admin/categories', wrap(async ({ body: b }) => {
  const name = (b.name || '').trim();
  if (!name) throw new Error('Category name required');
  if (await one('SELECT 1 AS x FROM categories WHERE LOWER(name)=LOWER(?)', [name])) throw new Error('That category already exists');
  const r = await q('INSERT INTO categories(name) VALUES (?)', [name]);
  return { category_id: r.insertId };
}));
app.delete('/api/admin/categories/:id', wrap(async ({ params }) => {
  if (await one('SELECT 1 AS x FROM items WHERE category_id=? LIMIT 1', [params.id])) throw new Error('This category still has items');
  await q('DELETE FROM categories WHERE category_id=?', [params.id]);
  return { deleted: true };
}));

// turns upload errors (too big, etc.) into JSON instead of an HTML page
app.use((err, req, res, next) =>
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 2 MB' : err.message }));
app.listen(5000, () => console.log('API on http://localhost:5000 (MySQL: ' + DB.database + ')'));