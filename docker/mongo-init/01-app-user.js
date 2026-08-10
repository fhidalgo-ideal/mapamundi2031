// Creates the application's database user. Mongo runs everything in
// /docker-entrypoint-initdb.d once, the first time it initializes an empty
// data directory, so this never re-runs against an existing database.
//
// The app gets readWrite on its own database and nothing else — the root
// account from MONGO_INITDB_ROOT_USERNAME stays reserved for administration
// and for mongodump/mongorestore.
const dbName = process.env.MONGO_DB_NAME || "granada2031";
const user = process.env.MONGO_APP_USER;
const password = process.env.MONGO_APP_PASSWORD;

if (!user || !password) {
  print("[mongo-init] MONGO_APP_USER/MONGO_APP_PASSWORD unset, skipping app user creation");
} else {
  const appDb = db.getSiblingDB(dbName);
  appDb.createUser({
    user: user,
    pwd: password,
    roles: [{ role: "readWrite", db: dbName }],
  });
  print(`[mongo-init] created user ${user} with readWrite on ${dbName}`);
}
