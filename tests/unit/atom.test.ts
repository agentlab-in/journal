import { describe, it, expect } from 'vitest'
import { renderAtomFeed, type AtomEntry, type AtomFeedInput } from '@/lib/atom'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY_A: AtomEntry = {
  id: 'https://agentlab.in/alice/post/first-post',
  url: 'https://agentlab.in/alice/post/first-post',
  title: 'First Post',
  summary: 'A short summary.',
  contentHtml: '<p>Hello <strong>world</strong>.</p>',
  authorName: 'Alice Anderson',
  authorHandle: 'alice',
  published: '2026-01-01T00:00:00Z',
  updated: '2026-01-02T00:00:00Z',
}

const FEED_BASE: AtomFeedInput = {
  title: 'agentlab.in',
  description: 'Community publishing for AI agent infrastructure.',
  selfUrl: 'https://agentlab.in/feed.xml',
  alternateUrl: 'https://agentlab.in/',
  feedId: 'https://agentlab.in/feed.xml',
  updated: '2026-01-02T00:00:00Z',
  entries: [ENTRY_A],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAtomFeed', () => {
  it('starts with the XML prolog and the Atom feed root', () => {
    const xml = renderAtomFeed(FEED_BASE)
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true)
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
  })

  it('emits feed-level id/title/subtitle/updated/self link/alternate link', () => {
    const xml = renderAtomFeed(FEED_BASE)
    expect(xml).toContain('<id>https://agentlab.in/feed.xml</id>')
    expect(xml).toContain('<title>agentlab.in</title>')
    expect(xml).toContain(
      '<subtitle>Community publishing for AI agent infrastructure.</subtitle>',
    )
    expect(xml).toContain('<updated>2026-01-02T00:00:00Z</updated>')
    expect(xml).toContain('<link rel="self" href="https://agentlab.in/feed.xml"/>')
    expect(xml).toContain('<link rel="alternate" href="https://agentlab.in/"/>')
  })

  it('emits per-entry id/title/link/published/updated/summary/content/author', () => {
    const xml = renderAtomFeed(FEED_BASE)
    expect(xml).toContain('<entry>')
    expect(xml).toContain('<id>https://agentlab.in/alice/post/first-post</id>')
    expect(xml).toContain('<title>First Post</title>')
    expect(xml).toContain(
      '<link rel="alternate" href="https://agentlab.in/alice/post/first-post"/>',
    )
    expect(xml).toContain('<published>2026-01-01T00:00:00Z</published>')
    expect(xml).toContain('<updated>2026-01-02T00:00:00Z</updated>')
    expect(xml).toContain('<summary>A short summary.</summary>')
    expect(xml).toContain('<content type="html">')
    // Author line bundles display name + @handle inside <name>.
    expect(xml).toContain('<name>Alice Anderson (@alice)</name>')
  })

  it('XML-escapes special chars in titles', () => {
    const xml = renderAtomFeed({
      ...FEED_BASE,
      entries: [
        {
          ...ENTRY_A,
          title: "Tom & Jerry's <script>",
        },
      ],
    })
    expect(xml).toContain('Tom &amp; Jerry&apos;s &lt;script&gt;')
    // And the raw form must not leak through.
    expect(xml).not.toContain("Tom & Jerry's <script>")
  })

  it('XML-escapes the HTML body inside <content type="html">', () => {
    const xml = renderAtomFeed({
      ...FEED_BASE,
      entries: [
        {
          ...ENTRY_A,
          contentHtml: '<p>Hi <em>there</em>.</p>',
        },
      ],
    })
    expect(xml).toContain(
      '<content type="html">&lt;p&gt;Hi &lt;em&gt;there&lt;/em&gt;.&lt;/p&gt;</content>',
    )
  })

  it('produces a valid feed wrapper for an empty entries array', () => {
    const xml = renderAtomFeed({ ...FEED_BASE, entries: [] })
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('</feed>')
    expect(xml).not.toContain('<entry>')
    expect(xml).toContain('<updated>2026-01-02T00:00:00Z</updated>')
  })

  it('strips XML-illegal C0 control chars from text fields', () => {
    // A single NUL in any user-supplied field would otherwise crash
    // every reader on the whole feed. Build the inputs via fromCharCode
    // so the test source has no literal control bytes.
    const NUL = String.fromCharCode(0x00)
    const BS = String.fromCharCode(0x08)
    const VT = String.fromCharCode(0x0b)
    const SO = String.fromCharCode(0x0e)
    const US = String.fromCharCode(0x1f)

    const xml = renderAtomFeed({
      ...FEED_BASE,
      entries: [
        {
          ...ENTRY_A,
          title: `Bad${NUL}title${BS}here`,
          contentHtml: `<p>body${VT}with${SO}junk${US}</p>`,
        },
      ],
    })

    expect(xml).toContain('<title>Badtitlehere</title>')
    expect(xml).not.toContain(NUL)
    expect(xml).not.toContain(BS)
    expect(xml).not.toContain(VT)
    expect(xml).not.toContain(SO)
    expect(xml).not.toContain(US)
    // Whole feed must still parse cleanly.
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror').length).toBe(0)
  })

  it('parses as XML and exposes structured children', () => {
    // jsdom is the vitest test environment — `DOMParser` is global.
    const xml = renderAtomFeed(FEED_BASE)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')

    // No parsererror element — well-formed XML.
    expect(doc.getElementsByTagName('parsererror').length).toBe(0)

    const feed = doc.documentElement
    expect(feed.tagName).toBe('feed')
    expect(feed.getAttribute('xmlns')).toBe('http://www.w3.org/2005/Atom')

    const entries = doc.getElementsByTagName('entry')
    expect(entries.length).toBe(1)
    expect(entries[0].getElementsByTagName('title')[0]?.textContent).toBe('First Post')
    expect(entries[0].getElementsByTagName('name')[0]?.textContent).toBe(
      'Alice Anderson (@alice)',
    )
  })
})
