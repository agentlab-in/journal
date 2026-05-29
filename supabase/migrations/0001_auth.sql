-- =============================================================================
-- 0001_auth.sql
-- NextAuth.js v4 tables (via @next-auth/supabase-adapter canonical SQL)
-- plus Phase 1 audit columns and RLS policies.
--
-- Adapter: @next-auth/supabase-adapter@0.2.1
-- Source:  node_modules/@next-auth/supabase-adapter/supabase/migrations/
--          20221108043803_create_next_auth_schema.sql (reproduced verbatim below)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- next_auth.users / .accounts / .sessions all default to uuid_generate_v4().
-- Supabase projects usually ship with uuid-ossp pre-enabled, but make this
-- migration self-contained.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. next_auth schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA next_auth;

GRANT USAGE ON SCHEMA next_auth TO service_role;
GRANT ALL ON SCHEMA next_auth TO postgres;

-- ---------------------------------------------------------------------------
-- 2. next_auth.users — extended with Phase 1 audit columns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS next_auth.users (
    id                                  uuid NOT NULL DEFAULT uuid_generate_v4(),
    name                                text,
    email                               text,
    "emailVerified"                     timestamp with time zone,
    image                               text,

    -- Phase 1 audit trail: gate decision inputs, written once at first sign-in.
    -- Prefer augmenting next_auth.users directly (simpler; adapter already writes here).
    github_login                        text,
    github_account_age_days_at_signup   int,
    github_public_repo_count_at_signup  int,

    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT email_unique UNIQUE (email)
);

GRANT ALL ON TABLE next_auth.users TO postgres;
GRANT ALL ON TABLE next_auth.users TO service_role;

-- ---------------------------------------------------------------------------
-- 3. next_auth.uid() — used in RLS policies
--    Source: canonical adapter migration (verbatim)
-- ---------------------------------------------------------------------------
CREATE FUNCTION next_auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- ---------------------------------------------------------------------------
-- 4. next_auth.sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS next_auth.sessions (
    id              uuid NOT NULL DEFAULT uuid_generate_v4(),
    expires         timestamp with time zone NOT NULL,
    "sessionToken"  text NOT NULL,
    "userId"        uuid,

    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT "sessionToken_unique" UNIQUE ("sessionToken"),
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

GRANT ALL ON TABLE next_auth.sessions TO postgres;
GRANT ALL ON TABLE next_auth.sessions TO service_role;

-- ---------------------------------------------------------------------------
-- 5. next_auth.accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS next_auth.accounts (
    id                  uuid NOT NULL DEFAULT uuid_generate_v4(),
    type                text NOT NULL,
    provider            text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token       text,
    access_token        text,
    expires_at          bigint,
    token_type          text,
    scope               text,
    id_token            text,
    session_state       text,
    oauth_token_secret  text,
    oauth_token         text,
    "userId"            uuid,

    CONSTRAINT accounts_pkey PRIMARY KEY (id),
    CONSTRAINT provider_unique UNIQUE (provider, "providerAccountId"),
    CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

GRANT ALL ON TABLE next_auth.accounts TO postgres;
GRANT ALL ON TABLE next_auth.accounts TO service_role;

-- ---------------------------------------------------------------------------
-- 6. next_auth.verification_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS next_auth.verification_tokens (
    identifier  text,
    token       text,
    expires     timestamp with time zone NOT NULL,

    CONSTRAINT verification_tokens_pkey PRIMARY KEY (token),
    CONSTRAINT token_unique UNIQUE (token),
    CONSTRAINT token_identifier_unique UNIQUE (token, identifier)
);

GRANT ALL ON TABLE next_auth.verification_tokens TO postgres;
GRANT ALL ON TABLE next_auth.verification_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS — explicit policies on all four NextAuth tables.
--
--    Auto-RLS is on at the project level; we spell policies out anyway
--    (defense-in-depth + auditability).
--
--    Strategy:
--      • Users can read their own row only (matched by next_auth.uid()).
--      • Service-role has full access (already granted above via GRANT ALL).
--      • No direct anon/authenticated mutations — all writes go through
--        the adapter, which uses the service-role key.
-- ---------------------------------------------------------------------------

-- next_auth.users
ALTER TABLE next_auth.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: service_role full access"
    ON next_auth.users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "users: read own row"
    ON next_auth.users
    FOR SELECT
    TO authenticated
    USING (next_auth.uid() = id);

-- next_auth.sessions
ALTER TABLE next_auth.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: service_role full access"
    ON next_auth.sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "sessions: read own sessions"
    ON next_auth.sessions
    FOR SELECT
    TO authenticated
    USING (next_auth.uid() = "userId");

-- next_auth.accounts
ALTER TABLE next_auth.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts: service_role full access"
    ON next_auth.accounts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "accounts: read own accounts"
    ON next_auth.accounts
    FOR SELECT
    TO authenticated
    USING (next_auth.uid() = "userId");

-- next_auth.verification_tokens
-- These are one-time tokens; no meaningful user-scoped read policy needed.
ALTER TABLE next_auth.verification_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verification_tokens: service_role full access"
    ON next_auth.verification_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
