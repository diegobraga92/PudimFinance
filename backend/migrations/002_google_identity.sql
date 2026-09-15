-- Google accounts are passwordless and identified by Google's stable `sub`.
ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL,
    ADD COLUMN google_sub TEXT;

ALTER TABLE users
    ADD CONSTRAINT users_auth_method_check
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);

CREATE UNIQUE INDEX users_google_sub_key
    ON users (google_sub)
    WHERE google_sub IS NOT NULL;