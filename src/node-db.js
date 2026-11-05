// node:sqlite adapter with the same async interface as the D1 adapter.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openNodeDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'parsley.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const norm = (params) => params.map((v) => v ?? null);
  return {
    raw: db,
    all: async (sql, params = []) => db.prepare(sql).all(...norm(params)),
    get: async (sql, params = []) => db.prepare(sql).get(...norm(params)) ?? null,
    run: async (sql, params = []) => ({ lastId: Number(db.prepare(sql).run(...norm(params)).lastInsertRowid) }),
    batch: async (sqls) => { for (const s of sqls) db.exec(s); },
    runMany: async (sql, rows) => {
      const st = db.prepare(sql);
      db.exec('BEGIN');
      try { for (const params of rows) st.run(...norm(params)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
