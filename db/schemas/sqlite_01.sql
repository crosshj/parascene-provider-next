-- SQLite schema for Parascene

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'consumer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY,
  user_name TEXT UNIQUE,
  display_name TEXT,
  about TEXT,
  socials TEXT,
  avatar_url TEXT,
  cover_image_url TEXT,
  badges TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_username
  ON user_profiles(user_name);

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INTEGER NOT NULL,
  following_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id
  ON user_follows(follower_id);

CREATE INDEX IF NOT EXISTS idx_user_follows_following_id
  ON user_follows(following_id);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS moderation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  server_url TEXT NOT NULL,
  auth_token TEXT,
  status TEXT NOT NULL,
  status_date TEXT,
  description TEXT,
  members_count INTEGER NOT NULL DEFAULT 0,
  server_config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS policy_knobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  actor_user_id INTEGER,
  type TEXT,
  target TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
-- For existing SQLite DBs, run:
-- ALTER TABLE notifications ADD COLUMN actor_user_id INTEGER;
-- ALTER TABLE notifications ADD COLUMN type TEXT;
-- ALTER TABLE notifications ADD COLUMN target TEXT;
-- ALTER TABLE notifications ADD COLUMN meta TEXT;

CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  campaign TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- For existing SQLite DBs created before last_creation_highlight_sent_at was added, run:
-- ALTER TABLE email_user_campaign_state ADD COLUMN last_creation_highlight_sent_at TEXT;
CREATE TABLE IF NOT EXISTS email_user_campaign_state (
  user_id INTEGER PRIMARY KEY,
  last_digest_sent_at TEXT,
  welcome_email_sent_at TEXT,
  first_creation_nudge_sent_at TEXT,
  last_reengagement_sent_at TEXT,
  last_creation_highlight_sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_send_id INTEGER NOT NULL,
  user_id INTEGER,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  path TEXT,
  meta TEXT,
  FOREIGN KEY (email_send_id) REFERENCES email_sends(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  author TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_image_id INTEGER
);

CREATE TABLE IF NOT EXISTS explore_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);


CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS created_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'creating',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  title TEXT,
  description TEXT,
  meta TEXT,
  unavailable_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  balance REAL NOT NULL DEFAULT 0,
  last_daily_claim_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tip activity: logs credits tipped between users (optionally tied to a created image)
CREATE TABLE IF NOT EXISTS tip_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  created_image_id INTEGER,
  amount REAL NOT NULL,
  message TEXT,
  source TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id),
  FOREIGN KEY (created_image_id) REFERENCES created_images(id)
);

CREATE INDEX IF NOT EXISTS idx_tip_activity_created_image_id_created_at
  ON tip_activity(created_image_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tip_activity_to_user_id_created_at
  ON tip_activity(to_user_id, created_at);

CREATE TABLE IF NOT EXISTS likes_created_image (
  user_id INTEGER NOT NULL,
  created_image_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_image_id) REFERENCES created_images(id),
  UNIQUE(user_id, created_image_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_created_image_created_image_id
  ON likes_created_image(created_image_id);

CREATE INDEX IF NOT EXISTS idx_likes_created_image_user_id
  ON likes_created_image(user_id);

CREATE TABLE IF NOT EXISTS comments_created_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_image_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_image_id) REFERENCES created_images(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_created_image_created_image_id_created_at
  ON comments_created_image(created_image_id, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_created_image_user_id
  ON comments_created_image(user_id);

-- Anonymous (try) creations: prompt-pool and per-request images. try_requests links anon_cid to created_image_anon_id.
CREATE TABLE IF NOT EXISTS created_images_anon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_created_images_anon_prompt ON created_images_anon(prompt);

-- Try requests: one row per try create call, keyed by anon_cid. When anon image is transitioned to a user, created_image_anon_id is set NULL and meta.transitioned records where it went.
CREATE TABLE IF NOT EXISTS try_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anon_cid TEXT NOT NULL,
  prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  fulfilled_at TEXT,
  created_image_anon_id INTEGER NULL,
  meta TEXT,
  FOREIGN KEY (created_image_anon_id) REFERENCES created_images_anon(id)
);
CREATE INDEX IF NOT EXISTS idx_try_requests_anon_cid ON try_requests(anon_cid);
CREATE INDEX IF NOT EXISTS idx_try_requests_created_image_anon_id ON try_requests(created_image_anon_id);

-- Related creations: view→next-click transitions for click-next ranking
CREATE TABLE IF NOT EXISTS related_transitions (
  from_created_image_id INTEGER NOT NULL REFERENCES created_images(id) ON DELETE CASCADE,
  to_created_image_id INTEGER NOT NULL REFERENCES created_images(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 1,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_created_image_id, to_created_image_id),
  CHECK(from_created_image_id != to_created_image_id)
);
CREATE INDEX IF NOT EXISTS idx_related_transitions_from ON related_transitions(from_created_image_id);
CREATE INDEX IF NOT EXISTS idx_related_transitions_from_last_updated ON related_transitions(from_created_image_id, last_updated);
CREATE INDEX IF NOT EXISTS idx_related_transitions_count ON related_transitions(count DESC);
