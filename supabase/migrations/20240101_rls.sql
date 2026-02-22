-- ─── Enable Row Level Security on all tables ─────────────────────────────────
ALTER TABLE agents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_type_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_robin_state ENABLE ROW LEVEL SECURITY;

-- ─── Helper: is the request from an authenticated admin? ─────────────────────
-- We use Supabase auth. Any logged-in user via the admin panel is a trusted admin.
-- For extra security you could add a `role` column to auth.users, but for a
-- small internal tool, any authenticated user = admin.

-- ─── booking_links: public can read active links ──────────────────────────────
CREATE POLICY "public_read_active_links"
  ON booking_links FOR SELECT
  TO anon
  USING (is_active = TRUE);

CREATE POLICY "admin_all_links"
  ON booking_links FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── event_types: public can read active types ───────────────────────────────
CREATE POLICY "public_read_active_event_types"
  ON event_types FOR SELECT
  TO anon
  USING (is_active = TRUE);

CREATE POLICY "admin_all_event_types"
  ON event_types FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── event_type_agents: public can read (needed for booking page) ─────────────
CREATE POLICY "public_read_event_type_agents"
  ON event_type_agents FOR SELECT
  TO anon
  USING (TRUE);

CREATE POLICY "admin_all_event_type_agents"
  ON event_type_agents FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── availability: service role only (used by edge functions) ─────────────────
-- Public cannot read availability directly (edge function handles it)
CREATE POLICY "admin_all_availability"
  ON availability FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── agents: admin-only (tokens must never leak to public) ────────────────────
CREATE POLICY "admin_all_agents"
  ON agents FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── bookings: public can insert (create booking), admin can read/update all ──
CREATE POLICY "public_insert_bookings"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (TRUE);

CREATE POLICY "admin_all_bookings"
  ON bookings FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── round_robin_state: service role only (via edge functions) ────────────────
CREATE POLICY "admin_all_round_robin"
  ON round_robin_state FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- NOTE: Edge functions use the service_role key, which bypasses RLS entirely.
-- The above policies protect the anon (public) key used by the frontend.
