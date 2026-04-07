-- Add HP/MP columns to players table (persists sense data)
ALTER TABLE players ADD COLUMN IF NOT EXISTS hp              INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS mp              INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_sense_update TIMESTAMPTZ;
