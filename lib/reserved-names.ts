/**
 * Reserved usernames — platform routes and protected identifiers.
 * All stored lowercase. isReserved() is case-insensitive.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Platform infrastructure
  'api',
  'admin',
  'auth',
  '_next',
  'static',
  'public',
  'assets',

  // Static pages
  'about',
  'contact',
  'help',
  'faq',
  'support',
  'privacy',
  'terms',
  'policy',
  'legal',
  'dmca',

  // Auth routes
  'login',
  'logout',
  'signin',
  'signout',
  'signup',
  'register',
  'sso',
  'oauth',

  // Editor / content routes
  'new',
  'write',
  'edit',
  'publish',
  'draft',
  'drafts',
  'editor',

  // Account routes
  'settings',
  'profile',
  'account',
  'me',
  'you',
  'dashboard',
  'billing',

  // Feed / discovery routes
  'home',
  'feed',
  'explore',
  'discover',
  'search',
  'trending',
  'popular',
  'top',
  'latest',
  'for-you',

  // Content types
  'post',
  'posts',
  'dive',
  'dives',
  'playbook',
  'playbooks',
  'pattern',
  'patterns',

  // Taxonomy
  'tag',
  'tags',
  'topic',
  'topics',
  'category',
  'categories',

  // User concepts
  'user',
  'users',
  'author',
  'authors',
  'org',
  'orgs',
  'team',
  'teams',

  // Social
  'bookmark',
  'bookmarks',
  'like',
  'likes',
  'follow',
  'followers',
  'following',
  'comment',
  'comments',
  'reply',
  'replies',
  'notification',
  'notifications',
  'inbox',

  // Moderation
  'report',
  'reports',
  'mod',
  'moderation',
  'flag',

  // System / SEO
  'rss',
  'atom',
  'feeds',
  'sitemap',
  'robots',
  'manifest',
  '.well-known',
  'favicon',

  // Brand / identity
  'agentlab',
  'agent',
  'lab',
  'root',
  'system',
  'anonymous',
  'deleted',

  // Error pages
  '404',
  '500',
  'error',
  'offline',

  // Harshit's bot account + curator org slug
  'hsb-agent',
  'agentlab-in',
])

/**
 * Returns true if the given name is reserved (case-insensitive).
 */
export function isReserved(name: string): boolean {
  return RESERVED_USERNAMES.has(name.toLowerCase())
}
