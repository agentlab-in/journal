-- =============================================================================
-- 0013_clear_oauth_tokens.sql
-- G7 — OAuth tokens stored in next_auth.accounts.access_token /
-- refresh_token are populated by @next-auth/supabase-adapter when a
-- user signs in, but the app never reads them again (lib/auth.ts uses
-- the in-memory `account.access_token` from the OAuth handshake, not
-- the DB row). GitHub's OAuth tokens are also not refreshed by the
-- NextAuth GitHub provider, so nulling them is safe.
--
-- This migration:
--   1. Nulls both columns for every existing row.
--   2. Installs a BEFORE INSERT/UPDATE trigger that prevents the
--      adapter from re-persisting them on future signins. The columns
--      stay nullable so NextAuth's INSERT shape doesn't break.
--
-- Aligns the database with Privacy Policy §2.6.
-- =============================================================================

update next_auth.accounts
set access_token = null,
    refresh_token = null
where access_token is not null
   or refresh_token is not null;

create or replace function next_auth.clear_oauth_tokens()
returns trigger
language plpgsql
as $$
begin
  new.access_token := null;
  new.refresh_token := null;
  return new;
end;
$$;

drop trigger if exists clear_oauth_tokens_trigger on next_auth.accounts;
create trigger clear_oauth_tokens_trigger
before insert or update on next_auth.accounts
for each row
execute function next_auth.clear_oauth_tokens();

comment on trigger clear_oauth_tokens_trigger on next_auth.accounts is
  'G7 / Privacy §2.6: drop access_token / refresh_token before persistence — the app does not consume them after the initial signIn callback.';
