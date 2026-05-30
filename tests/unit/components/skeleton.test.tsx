/**
 * Skeleton composites — accessibility contract.
 *
 * The presentational pulsing primitives are decorative and must be
 * `aria-hidden` so screen readers don't enumerate every bar/circle.
 * The outer composite wraps the group in `role="status"` with an
 * `aria-label` containing "loading" so an SR user gets ONE announcement
 * per loading region.
 *
 * These tests pin those guarantees so a future refactor that strips an
 * attribute lights up CI before it hits a11y audits.
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'
import { CommentSkeleton } from '@/components/skeleton/CommentSkeleton'
import { ProfileHeaderSkeleton } from '@/components/skeleton/ProfileHeaderSkeleton'
import { SearchResultSkeleton } from '@/components/skeleton/SearchResultSkeleton'

interface CaseSpec {
  name: string
  render: () => React.ReactElement
  countProp?: { value: number; itemSelector: string }
}

const cases: CaseSpec[] = [
  {
    name: 'PostCardSkeleton',
    render: () => <PostCardSkeleton />,
    countProp: { value: 3, itemSelector: '.home-feed__item' },
  },
  {
    name: 'CommentSkeleton',
    render: () => <CommentSkeleton />,
    countProp: { value: 4, itemSelector: 'article' },
  },
  {
    name: 'ProfileHeaderSkeleton',
    render: () => <ProfileHeaderSkeleton />,
  },
  {
    name: 'SearchResultSkeleton',
    render: () => <SearchResultSkeleton />,
    countProp: { value: 2, itemSelector: '.search-page__item' },
  },
]

describe('skeleton composites', () => {
  for (const c of cases) {
    describe(`<${c.name}>`, () => {
      it('renders without crashing', () => {
        const { container } = render(c.render())
        // sanity: produced at least one node
        expect(container.firstChild).toBeTruthy()
      })

      it('exposes role="status" with a loading aria-label', () => {
        const { container } = render(c.render())
        const status = container.querySelector('[role="status"]')
        expect(status).not.toBeNull()
        const label = status!.getAttribute('aria-label') ?? ''
        // Case-insensitive check — different composites use "Loading
        // posts" / "Loading comments" / "Loading profile" / etc.
        expect(label.toLowerCase()).toContain('loading')
      })

      it('marks every pulsing primitive aria-hidden', () => {
        const { container } = render(c.render())
        const pulsing = container.querySelectorAll('.animate-pulse')
        // Smoke check: at least one pulsing node exists.
        expect(pulsing.length).toBeGreaterThan(0)
        for (const el of Array.from(pulsing)) {
          // Either the element itself or its closest ancestor must
          // carry aria-hidden — both patterns hide it from SR
          // enumeration. (Some composites mark the wrapping <article>
          // as the hidden boundary instead of every leaf.)
          const hiddenOnSelf = el.getAttribute('aria-hidden') === 'true'
          const hiddenOnAncestor = el.closest('[aria-hidden="true"]') !== null
          expect(hiddenOnSelf || hiddenOnAncestor).toBe(true)
        }
      })
    })
  }

  describe('count prop', () => {
    for (const c of cases) {
      if (!c.countProp) continue
      it(`${c.name} renders the requested number of items`, () => {
        const Comp = c.render().type as (props: { count: number }) => React.ReactElement
        const { container } = render(<Comp count={c.countProp!.value} />)
        const items = container.querySelectorAll(c.countProp!.itemSelector)
        expect(items.length).toBe(c.countProp!.value)
      })
    }
  })
})
