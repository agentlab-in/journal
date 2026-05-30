/**
 * GitHub REST API helpers.
 * Only the fields we need for the sign-up gate.
 */

export interface GitHubUser {
  login: string
  public_repos: number
  created_at: string // ISO 8601
  name: string | null
  bio: string | null
  avatar_url: string
  email: string | null
  followers: number
}

/**
 * Fetch the authenticated GitHub user via their OAuth access token.
 * Uses `read:user` scope, which is included in NextAuth's default GitHub
 * scope and is sufficient for `email` (public profile email) and `followers`.
 */
export async function fetchGithubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
    // Don't cache — we want the live value every sign-in for the gate check.
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`GitHub /user fetch failed: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<GitHubUser>
}
