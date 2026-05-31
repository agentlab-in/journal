import { describe, it, expect } from 'vitest'
import {
  articleJsonLd,
  personJsonLd,
  type ArticleJsonLdInput,
  type PersonJsonLdInput,
} from '@/lib/json-ld'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARTICLE_BASE: ArticleJsonLdInput = {
  type: 'post',
  title: 'First Post',
  summary: 'A short summary.',
  coverImageUrl: null,
  publishedAt: '2026-01-01T00:00:00Z',
  editedAt: null,
  canonicalPath: '/alice/post/first-post',
  authorName: 'Alice Anderson',
  authorUsername: 'alice',
}

const PERSON_BASE: PersonJsonLdInput = {
  username: 'alice',
  displayName: 'Alice Anderson',
  bio: null,
  avatarUrl: null,
  githubLogin: null,
}

function parseArticle(input: ArticleJsonLdInput): Record<string, unknown> {
  return JSON.parse(articleJsonLd(input)) as Record<string, unknown>
}

function parsePerson(input: PersonJsonLdInput): Record<string, unknown> {
  return JSON.parse(personJsonLd(input)) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// articleJsonLd
// ---------------------------------------------------------------------------

describe('articleJsonLd', () => {
  it("emits '@type': 'Article' for type=post", () => {
    expect(parseArticle({ ...ARTICLE_BASE, type: 'post' })['@type']).toBe('Article')
  })

  it("emits '@type': 'Article' for type=playbook", () => {
    expect(parseArticle({ ...ARTICLE_BASE, type: 'playbook' })['@type']).toBe(
      'Article',
    )
  })

  it("emits '@type': 'TechArticle' for type=dive", () => {
    expect(parseArticle({ ...ARTICLE_BASE, type: 'dive' })['@type']).toBe(
      'TechArticle',
    )
  })

  it('falls back to absolute /og.png when coverImageUrl is null', () => {
    const parsed = parseArticle({ ...ARTICLE_BASE, coverImageUrl: null })
    const image = parsed.image as string
    expect(image.endsWith('/og.png')).toBe(true)
    expect(image.startsWith('http')).toBe(true)
  })

  it('passes through an already-absolute coverImageUrl unchanged', () => {
    const url = 'https://example.com/cover.jpg'
    const parsed = parseArticle({ ...ARTICLE_BASE, coverImageUrl: url })
    expect(parsed.image).toBe(url)
  })

  it('reuses datePublished for dateModified when editedAt is null', () => {
    const parsed = parseArticle({ ...ARTICLE_BASE, editedAt: null })
    expect(parsed.dateModified).toBe(parsed.datePublished)
    expect(parsed.dateModified).toBe('2026-01-01T00:00:00Z')
  })

  it('uses editedAt for dateModified when provided', () => {
    const parsed = parseArticle({
      ...ARTICLE_BASE,
      editedAt: '2026-02-15T12:00:00Z',
    })
    expect(parsed.dateModified).toBe('2026-02-15T12:00:00Z')
  })

  it('builds an absolute author.url from authorUsername', () => {
    const parsed = parseArticle({ ...ARTICLE_BASE, authorUsername: 'alice' })
    const author = parsed.author as { url: string; name: string }
    expect(author.url.endsWith('/alice')).toBe(true)
    expect(author.url.startsWith('http')).toBe(true)
    expect(author.name).toBe('Alice Anderson')
  })

  it('emits publisher=agentlab.in with absolute /icon.png logo', () => {
    const parsed = parseArticle(ARTICLE_BASE)
    const publisher = parsed.publisher as {
      name: string
      logo: { url: string }
    }
    expect(publisher.name).toBe('agentlab.in')
    expect(publisher.logo.url.endsWith('/icon.png')).toBe(true)
    expect(publisher.logo.url.startsWith('http')).toBe(true)
  })

  it("mainEntityOfPage['@id'] is the absolute canonical URL", () => {
    const parsed = parseArticle(ARTICLE_BASE)
    const mainEntity = parsed.mainEntityOfPage as { '@id': string }
    expect(mainEntity['@id'].endsWith('/alice/post/first-post')).toBe(true)
    expect(mainEntity['@id'].startsWith('http')).toBe(true)
  })

  it('produces valid JSON', () => {
    expect(() => JSON.parse(articleJsonLd(ARTICLE_BASE))).not.toThrow()
  })

  it("escapes '</' as '<\\/' so it can be inlined inside a <script> tag", () => {
    const raw = articleJsonLd({
      ...ARTICLE_BASE,
      title: 'Sneaky </script> attempt',
    })
    expect(raw).not.toContain('</script>')
    expect(raw).toContain('<\\/script>')
    // Still parses as JSON — forward-slash escapes are legal in JSON strings.
    const parsed = JSON.parse(raw) as { headline: string }
    expect(parsed.headline).toBe('Sneaky </script> attempt')
  })
})

// ---------------------------------------------------------------------------
// personJsonLd
// ---------------------------------------------------------------------------

describe('personJsonLd', () => {
  it("emits '@type': 'Person'", () => {
    expect(parsePerson(PERSON_BASE)['@type']).toBe('Person')
  })

  it("alternateName is '@' + username", () => {
    expect(parsePerson({ ...PERSON_BASE, username: 'alice' }).alternateName).toBe(
      '@alice',
    )
  })

  it('omits description when bio is null', () => {
    const parsed = parsePerson({ ...PERSON_BASE, bio: null })
    expect('description' in parsed).toBe(false)
  })

  it('sets description when bio is provided', () => {
    expect(parsePerson({ ...PERSON_BASE, bio: 'Hello' }).description).toBe('Hello')
  })

  it('omits image when avatarUrl is null', () => {
    const parsed = parsePerson({ ...PERSON_BASE, avatarUrl: null })
    expect('image' in parsed).toBe(false)
  })

  it('omits sameAs when githubLogin is null', () => {
    const parsed = parsePerson({ ...PERSON_BASE, githubLogin: null })
    expect('sameAs' in parsed).toBe(false)
  })

  it('emits sameAs=[github profile URL] when githubLogin is present', () => {
    const parsed = parsePerson({ ...PERSON_BASE, githubLogin: 'alice' })
    expect(parsed.sameAs).toEqual(['https://github.com/alice'])
  })

  it('produces valid JSON', () => {
    expect(() => JSON.parse(personJsonLd(PERSON_BASE))).not.toThrow()
  })
})
