# Community Rental Management System — React + Express + MySQL

## Project layout
- `client/` — React + Vite frontend
- `server/` — Express API
- `schema.sql` — database schema; the server reads this file automatically on startup
- `database/rental-backup.sql` — optional SQL backup with sample data

> The server uses MySQL (`mysql2`), not the `rental(1).db` SQLite file.

## 1. Set up the database in MySQL Workbench
1. Start the **MySQL80** service in Windows Services, then open MySQL Workbench and connect to your local MySQL server.
2. Choose one option:
   - **Fresh database:** open and execute the root `schema.sql` file in Workbench.
   - **Database with sample data:** use **Server → Data Import**, choose `database/rental-backup.sql`, select/start the import, and refresh Schemas.
3. Confirm the schema named `rental` exists and contains `members`, `categories`, `items`, `rentals`, and `payments`.

Do not import both options unless you intentionally want to combine them. Back up any existing `rental` database before importing.

## 2. Configure and run the server
Open a terminal in the project folder:

```powershell
cd server
Copy-Item .env.example .env
```

Edit `server/.env` and set `DB_PASSWORD` to your actual MySQL password. If your root account has no password, leave it empty (`DB_PASSWORD=`). Then run:

```powershell
npm install
npm start
```

Expected message: `API on http://localhost:5000 (MySQL: rental)`
Keep this terminal open. The API creates missing tables/categories from `schema.sql` at startup. It does not create a MySQL user or reset an existing database.

## 3. Run the React client
Open a **second** terminal in the project folder:

```powershell
cd client
npm install
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`. Keep both terminals open. Vite proxies `/api` and `/uploads` to the API at port 5000.

## 4. Login
- Admin username: `admin`
- Admin password: `admin123`
- Members can register through the client.

Change the admin password and `JWT_SECRET` before using this outside a local demo.

## Troubleshooting
- `Could not set up MySQL`: make sure MySQL80 is running and `server/.env` credentials/database name are correct.
- `ENOENT ... schema.sql`: keep root `schema.sql` beside the `client` and `server` folders; do not move it into `server`.
- `Failed to fetch`: check that the server terminal is still running on port 5000.
- `Cannot find module ...`: run `npm install` in the folder that reported the error (`server` or `client`).
- Use MySQL Workbench/MySQL Server for this app; the supplied `.db` file is SQLite and is not used by this backend.
