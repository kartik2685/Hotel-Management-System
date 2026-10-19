-- Twin of ../003-signin-link-kind.sql: what a sign-in link is for ('reset', 'invite' or 'password').
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS kind text COLLATE "C" NOT NULL DEFAULT 'reset' CHECK (kind IN ('reset', 'invite', 'password'));
