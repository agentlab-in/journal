import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0013_clear_oauth_tokens.sql'),
    'utf8',
  )
})

describe('0013_clear_oauth_tokens.sql shape', () => {
  it('nulls access_token and refresh_token for existing rows', () => {
    expect(migration).toMatch(/update next_auth\.accounts/i)
    expect(migration).toMatch(/access_token\s*=\s*null/i)
    expect(migration).toMatch(/refresh_token\s*=\s*null/i)
  })

  it('only touches rows where at least one token column is non-null', () => {
    expect(migration).toMatch(/access_token is not null/i)
    expect(migration).toMatch(/refresh_token is not null/i)
  })

  it('defines a clear_oauth_tokens trigger function in next_auth', () => {
    expect(migration).toMatch(
      /create or replace function next_auth\.clear_oauth_tokens/i,
    )
  })

  it('installs a BEFORE INSERT OR UPDATE trigger on next_auth.accounts', () => {
    expect(migration).toMatch(/drop trigger if exists clear_oauth_tokens_trigger/i)
    expect(migration).toMatch(
      /create trigger clear_oauth_tokens_trigger[\s\S]*before insert or update on next_auth\.accounts/i,
    )
  })

  it('the trigger sets both token columns to null on new rows', () => {
    expect(migration).toMatch(/new\.access_token\s*:=\s*null/i)
    expect(migration).toMatch(/new\.refresh_token\s*:=\s*null/i)
  })

  it('documents the trigger purpose so future operators understand it', () => {
    expect(migration).toMatch(
      /comment on trigger clear_oauth_tokens_trigger on next_auth\.accounts is/i,
    )
  })
})
