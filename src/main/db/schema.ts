import type { Db } from './driver'

export const SCHEMA_VERSION = 1

// 플랫폼 공통 데이터: games, user_data, playtime_snapshots, play_sessions, hltb
// Steam 전용 데이터: steam_* (appid 기준)
// API에서 받은 데이터와 사용자가 입력한 데이터(user_data)는 분리해서 동기화가 입력값을 덮어쓰지 않게 한다.
const SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS games (
  platform TEXT NOT NULL,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  playtime_min INTEGER NOT NULL DEFAULT 0,
  playtime_2w_min INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  has_stats INTEGER NOT NULL DEFAULT 0,
  owned INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (platform, game_id)
);

CREATE TABLE IF NOT EXISTS user_data (
  platform TEXT NOT NULL,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'none',
  status_auto INTEGER NOT NULL DEFAULT 0,
  excluded INTEGER NOT NULL DEFAULT 0,
  purchase_price INTEGER,
  purchase_date TEXT,
  purchase_source TEXT,
  acquired_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  hltb_main_manual REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (platform, game_id)
);

CREATE TABLE IF NOT EXISTS playtime_snapshots (
  platform TEXT NOT NULL,
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (platform, game_id, date)
);
CREATE INDEX IF NOT EXISTS idx_snap_date ON playtime_snapshots(date);

CREATE TABLE IF NOT EXISTS play_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS hltb (
  platform TEXT NOT NULL,
  game_id TEXT NOT NULL,
  hltb_id INTEGER,
  matched_name TEXT,
  main REAL,
  extra REAL,
  complete REAL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform, game_id)
);

CREATE TABLE IF NOT EXISTS steam_app (
  appid INTEGER PRIMARY KEY,
  type TEXT,
  name TEXT,
  name_ko TEXT,
  is_free INTEGER NOT NULL DEFAULT 0,
  header_image TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  release_date TEXT,
  status TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_price (
  appid INTEGER NOT NULL,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  initial INTEGER NOT NULL,
  final INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (appid, region)
);

-- 가격이 바뀐 시점만 기록한다 (프로그램 설치 이후 자체 기록)
CREATE TABLE IF NOT EXISTS steam_price_history (
  appid INTEGER NOT NULL,
  region TEXT NOT NULL,
  initial INTEGER NOT NULL,
  final INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (appid, region, recorded_at)
);

CREATE TABLE IF NOT EXISTS steam_low (
  appid INTEGER NOT NULL,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  regular INTEGER,
  cut INTEGER NOT NULL DEFAULT 0,
  at TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (appid, region)
);

CREATE TABLE IF NOT EXISTS itad_map (
  appid INTEGER PRIMARY KEY,
  itad_id TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_ach (
  appid INTEGER NOT NULL,
  apiname TEXT NOT NULL,
  name TEXT,
  description TEXT,
  icon TEXT,
  icon_gray TEXT,
  achieved INTEGER NOT NULL DEFAULT 0,
  unlock_time INTEGER,
  global_pct REAL,
  PRIMARY KEY (appid, apiname)
);
CREATE INDEX IF NOT EXISTS idx_ach_unlock ON steam_ach(unlock_time);

CREATE TABLE IF NOT EXISTS steam_ach_summary (
  appid INTEGER PRIMARY KEY,
  total INTEGER NOT NULL,
  done INTEGER NOT NULL,
  playtime_at_fetch INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wishlist (
  appid INTEGER PRIMARY KEY,
  added_at INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  type TEXT,
  items TEXT NOT NULL,
  total INTEGER,
  currency TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL,
  UNIQUE (date, items, total)
);

CREATE TABLE IF NOT EXISTS reco_pool (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  genres TEXT NOT NULL,
  positive INTEGER NOT NULL,
  negative INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
`

export function migrate(db: Db): void {
  db.exec(SQL)
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
}
