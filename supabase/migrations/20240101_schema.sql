-- ─── Enable required extensions ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Agents (team members) ────────────────────────────────────────────────────
CREATE TABLE agents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  google_access_token  TEXT,            -- stored encrypted in production
  google_refresh_token TEXT,
  google_token_expiry  TIMESTAMPTZ,
  google_calendar_id   TEXT NOT NULL DEFAULT 'primary',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Event types ─────────────────────────────────────────────────────────────
CREATE TABLE event_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_minutes   INTEGER NOT NULL DEFAULT 5,
  description      TEXT,
  location         TEXT,
  color            TEXT NOT NULL DEFAULT '#4F46E5',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Event type ↔ Agent assignments ─────────────────────────────────────────
CREATE TABLE event_type_agents (
  event_type_id UUID NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id)      ON DELETE CASCADE,
  PRIMARY KEY (event_type_id, agent_id)
);

-- ─── Booking links (shareable URLs) ─────────────────────────────────────────
CREATE TABLE booking_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  event_type_id UUID NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  title         TEXT,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_links_slug ON booking_links(slug) WHERE is_active = TRUE;

-- ─── Agent availability (weekly recurring schedule) ──────────────────────────
CREATE TABLE availability (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'America/New_York',
  CONSTRAINT end_after_start CHECK (end_time > start_time),
  UNIQUE (agent_id, day_of_week)
);

-- ─── Confirmed bookings ───────────────────────────────────────────────────────
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id   UUID NOT NULL REFERENCES event_types(id),
  agent_id        UUID NOT NULL REFERENCES agents(id),
  booking_link_id UUID          REFERENCES booking_links(id),
  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  google_event_id TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_agent_time ON bookings(agent_id, start_time) WHERE status = 'confirmed';
CREATE INDEX idx_bookings_start_time ON bookings(start_time) WHERE status = 'confirmed';

-- ─── Round-robin state (pointer per event type) ───────────────────────────────
CREATE TABLE round_robin_state (
  event_type_id UUID PRIMARY KEY REFERENCES event_types(id) ON DELETE CASCADE,
  last_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
