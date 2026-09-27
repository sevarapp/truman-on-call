-- Tiger Data (TimescaleDB) schema. Runs automatically on server start; safe to re-run.

-- Every card a player drops: which emergency, what they picked, right or wrong, how long they took.
CREATE TABLE IF NOT EXISTS answers (
  ts       timestamptz NOT NULL DEFAULT now(),
  player   text,
  level    text,
  step     int,
  card     text,
  zone     text,
  correct  boolean,
  ms       int
);
SELECT create_hypertable('answers', by_range('ts'), if_not_exists => TRUE);

-- Every single chest compression in the CPR mini-game (true high-frequency time-series).
CREATE TABLE IF NOT EXISTS compressions (
  ts          timestamptz NOT NULL,
  player      text,
  session_id  text,
  interval_ms int,
  bpm         real
);
SELECT create_hypertable('compressions', by_range('ts'), if_not_exists => TRUE);
-- where the compression came from: tap, motion (phone accelerometer), cam (webcam), serial (force sensor)
ALTER TABLE compressions ADD COLUMN IF NOT EXISTS source text;

-- One row per finished level, for the leaderboard.
CREATE TABLE IF NOT EXISTS sessions (
  ts      timestamptz NOT NULL DEFAULT now(),
  player  text,
  level   text,
  score   int,
  stars   int
);
SELECT create_hypertable('sessions', by_range('ts'), if_not_exists => TRUE);

-- Continuous aggregate: which myths people fall for, rolled up hourly.
CREATE MATERIALIZED VIEW IF NOT EXISTS answers_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', ts) AS bucket, level, card, correct,
       count(*) AS n, avg(ms) AS avg_ms
FROM answers
GROUP BY bucket, level, card, correct
WITH NO DATA;

SELECT add_continuous_aggregate_policy('answers_hourly',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Continuous aggregate: CPR quality per minute across all players.
CREATE MATERIALIZED VIEW IF NOT EXISTS cpr_minutely
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 minute', ts) AS bucket,
       count(*) AS pushes,
       avg(bpm) AS avg_bpm,
       avg(CASE WHEN bpm BETWEEN 100 AND 120 THEN 1.0 ELSE 0.0 END) AS in_zone
FROM compressions
GROUP BY bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cpr_minutely',
  start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE);
