-- What a sign-in link is for (services/signin-links.js): 'reset' asked for on the sign-in page, 'invite' made
-- by an admin for a new account, 'password' made by an admin for someone who forgot theirs.
ALTER TABLE password_resets ADD COLUMN kind TEXT NOT NULL DEFAULT 'reset' CHECK (kind IN ('reset', 'invite', 'password'));
