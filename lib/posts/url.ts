export type PostType = 'post' | 'playbook' | 'dive'
export const POST_TYPES: readonly PostType[] = ['post', 'playbook', 'dive'] as const

export function postUrl(username: string, type: PostType, slug: string): string {
  return `/${username}/${type}/${slug}`
}

export function isPostType(value: string): value is PostType {
  return (POST_TYPES as readonly string[]).includes(value)
}
