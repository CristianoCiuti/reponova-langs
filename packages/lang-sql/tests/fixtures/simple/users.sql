-- Minimal user/auth schema in plain PostgreSQL syntax.
-- Used as the "simple" tier fixture for @reponova/lang-sql.

CREATE TABLE users (
    id        SERIAL PRIMARY KEY,
    email     VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
    id         UUID PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE UNIQUE INDEX idx_users_email_lower ON users(LOWER(email));

CREATE VIEW active_sessions AS
SELECT s.id, s.user_id, u.email, s.expires_at
FROM   sessions s
JOIN   users    u ON s.user_id = u.id
WHERE  s.expires_at > NOW();
