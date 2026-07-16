-- JAM (shared focus): usernames of everyone in the jam, JSON array, null when solo
ALTER TABLE sessions ADD COLUMN jam_members TEXT;
