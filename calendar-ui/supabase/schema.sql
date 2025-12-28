-- LifeSynced Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Appointments table (calendar events)
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT DEFAULT '',
  organizer_email TEXT DEFAULT '',
  organizer_name TEXT DEFAULT '',
  attendees JSONB DEFAULT '[]',
  body_preview TEXT DEFAULT '',
  is_all_day BOOLEAN DEFAULT FALSE,
  source TEXT NOT NULL CHECK (source IN ('graph_api', 'ics', 'apple_calendar')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ignored base IDs (recurring event series to hide)
CREATE TABLE IF NOT EXISTS ignored_base_ids (
  base_id TEXT PRIMARY KEY,
  subject TEXT DEFAULT '',
  ignored_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT DEFAULT 'User ignored'
);

-- Ignored event IDs (specific occurrences to hide)
CREATE TABLE IF NOT EXISTS ignored_event_ids (
  event_id TEXT PRIMARY KEY,
  subject TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  reason TEXT DEFAULT 'User ignored',
  ignored_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync metadata (track last sync times)
CREATE TABLE IF NOT EXISTS sync_metadata (
  id TEXT PRIMARY KEY DEFAULT 'default',
  last_outlook_sync TIMESTAMPTZ,
  last_ics_sync TIMESTAMPTZ,
  last_apple_sync TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_end_time ON appointments(end_time);
CREATE INDEX IF NOT EXISTS idx_appointments_source ON appointments(source);
CREATE INDEX IF NOT EXISTS idx_appointments_subject_source ON appointments(subject, source, start_time);

-- Row Level Security (RLS) - Enabled for security
-- Service role key bypasses RLS, so your app still works
-- But anon key users (public) cannot access any data
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ignored_base_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE ignored_event_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- No policies defined = no public access allowed
-- Only service_role key can read/write (which your app uses)

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS appointments_updated_at ON appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS sync_metadata_updated_at ON sync_metadata;
CREATE TRIGGER sync_metadata_updated_at
  BEFORE UPDATE ON sync_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Insert default sync metadata row
INSERT INTO sync_metadata (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

