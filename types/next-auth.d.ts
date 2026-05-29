/**
 * Module augmentation: extend the default NextAuth Session.user shape
 * with the database `id` we surface via the session callback in
 * lib/auth.ts. Without this, TypeScript treats `session.user.id` as
 * `any` (loose) or unknown (strict).
 */
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}
