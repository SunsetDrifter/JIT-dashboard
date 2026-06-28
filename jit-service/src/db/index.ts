import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type DB = Database.Database;

/**
 * Open (and migrate) the JIT SQLite database. Pass ":memory:" for tests.
 * WAL mode is enabled for concurrent reads alongside the scheduler's writes.
 */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
