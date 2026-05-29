import { describe, it, expect } from 'vitest'
import { buildCommentTree } from '@/lib/comments/tree'
import type { FlatComment } from '@/lib/comments/tree'

interface TestComment extends FlatComment {
  body: string
  deleted_at: string | null
}

function mk(
  id: string,
  parent: string | null,
  created: string,
  extras: Partial<TestComment> = {},
): TestComment {
  return {
    id,
    parent_comment_id: parent,
    created_at: created,
    body: extras.body ?? `body of ${id}`,
    deleted_at: extras.deleted_at ?? null,
  }
}

describe('buildCommentTree', () => {
  it('returns an empty array for empty input', () => {
    expect(buildCommentTree([])).toEqual([])
  })

  it('returns top-level comments as roots, ordered by created_at ASC', () => {
    const flat = [
      mk('c2', null, '2026-05-02T00:00:00Z'),
      mk('c1', null, '2026-05-01T00:00:00Z'),
      mk('c3', null, '2026-05-03T00:00:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree.map((n) => n.comment.id)).toEqual(['c1', 'c2', 'c3'])
    expect(tree.map((n) => n.depth)).toEqual([1, 1, 1])
  })

  it('nests children under their parent and sorts siblings by created_at ASC', () => {
    const flat = [
      mk('root', null, '2026-05-01T00:00:00Z'),
      mk('child-b', 'root', '2026-05-01T02:00:00Z'),
      mk('child-a', 'root', '2026-05-01T01:00:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.comment.id)).toEqual([
      'child-a',
      'child-b',
    ])
    expect(tree[0].depth).toBe(1)
    expect(tree[0].children[0].depth).toBe(2)
    expect(tree[0].children[1].depth).toBe(2)
  })

  it('assigns correct depths down a deep chain', () => {
    const flat = [
      mk('d1', null, '2026-05-01T00:00:00Z'),
      mk('d2', 'd1', '2026-05-01T00:01:00Z'),
      mk('d3', 'd2', '2026-05-01T00:02:00Z'),
      mk('d4', 'd3', '2026-05-01T00:03:00Z'),
      mk('d5', 'd4', '2026-05-01T00:04:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree).toHaveLength(1)
    let node = tree[0]
    const depths = [node.depth]
    while (node.children.length > 0) {
      node = node.children[0]
      depths.push(node.depth)
    }
    expect(depths).toEqual([1, 2, 3, 4, 5])
  })

  it('preserves children of a soft-deleted parent', () => {
    const flat = [
      mk('parent', null, '2026-05-01T00:00:00Z', {
        deleted_at: '2026-05-01T01:00:00Z',
      }),
      mk('child', 'parent', '2026-05-01T00:30:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.id).toBe('parent')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].comment.id).toBe('child')
  })

  it('promotes orphans (parent_comment_id refers to a missing row) to roots', () => {
    const flat = [
      mk('orphan', 'missing-parent-id', '2026-05-01T00:00:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.id).toBe('orphan')
    expect(tree[0].depth).toBe(1)
  })

  it('processes children in either input order (parent-before-child or child-before-parent)', () => {
    // child appears before parent in input — builder must still attach
    // it correctly using the pre-allocated id map.
    const flat = [
      mk('child', 'root', '2026-05-01T01:00:00Z'),
      mk('root', null, '2026-05-01T00:00:00Z'),
    ]
    const tree = buildCommentTree(flat)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.id).toBe('root')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].comment.id).toBe('child')
  })
})
