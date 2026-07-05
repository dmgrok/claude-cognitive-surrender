import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DATA_DIR = join(homedir(), '.cognitive-surrender');
export const DB_PATH = join(DATA_DIR, 'data.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  hook_event TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT NOT NULL,
  tool_input_summary TEXT,
  raw_input_length INTEGER,
  cwd TEXT,
  user TEXT NOT NULL,
  matched INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_summary TEXT,
  input_length INTEGER,
  decision_time_ms INTEGER,
  complexity REAL NOT NULL,
  threshold_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  user TEXT NOT NULL,
  cwd TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_tool
  ON events(session_id, tool_name, hook_event);
CREATE INDEX IF NOT EXISTS idx_events_timestamp
  ON events(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_decisions_user
  ON decisions(user);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp
  ON decisions(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_decisions_verdict
  ON decisions(user, verdict);
`;

export function openDb(): Database.Database {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

export type Verdict = 'reviewed' | 'surrendered' | 'auto_approved';

export interface Event {
  id: number;
  timestamp_ms: number;
  session_id: string;
  hook_event: string;
  tool_name: string;
  tool_input_hash: string;
  tool_input_summary: string | null;
  raw_input_length: number | null;
  cwd: string | null;
  user: string;
  matched: number;
}

export interface Decision {
  id: number;
  session_id: string;
  timestamp_ms: number;
  tool_name: string;
  tool_input_summary: string | null;
  input_length: number | null;
  decision_time_ms: number | null;
  complexity: number;
  threshold_ms: number;
  verdict: Verdict;
  user: string;
  cwd: string | null;
}
