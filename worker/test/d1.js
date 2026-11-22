// Doble de D1 para los tests de Vitest, sobre SQLite de Node (`node:sqlite`, Node ≥ 22.5).
// Implementa lo que usa el Worker: prepare().bind().first()/all()/run() y batch() como transacción.
// Aplica las migraciones reales de migrations/ y activa las claves foráneas como D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)));
  }

  _exec() {
    const stmt = this.db.sqlite.prepare(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      const results = stmt.all(...this.params).map((r) => ({ ...r }));
      return { success: true, results, meta: { changes: 0, rows_read: results.length, rows_written: 0 } };
    }
    const info = stmt.run(...this.params);
    this.db.writes += Number(info.changes);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), rows_written: Number(info.changes) } };
  }

  async first(column) {
    const row = this._exec().results[0] ?? null;
    if (row && column) return row[column] ?? null;
    return row;
  }

  async all() {
    return this._exec();
  }

  async run() {
    return this._exec();
  }
}

export class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.writes = 0;
    this.batches = 0;
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    this.batches += 1;
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s._exec());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
  }
}
