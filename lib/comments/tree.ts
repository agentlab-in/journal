/**
 * Pure tree builder for threaded comments.
 *
 * The render layer wants a depth-1 array of root comments, each carrying
 * its own `children` array and a precomputed `depth` (1-indexed: roots
 * are depth 1). Building this in-memory from the flat list returned by
 * the server avoids a recursive client query and lets us preserve soft-
 * deleted parents (so their non-deleted children still render under the
 * "[removed]" placeholder).
 *
 * Orphans — comments whose parent_comment_id points at a row not in the
 * input list — are promoted to roots. This shouldn't happen in production
 * because the API rejects unknown parents at insert time, but defending
 * against it keeps a half-loaded page from silently dropping replies.
 */

export interface FlatComment {
  id: string
  parent_comment_id: string | null
  created_at: string
  // Allow callers to thread arbitrary extra fields through without
  // widening the tree builder's contract.
  [key: string]: unknown
}

export interface TreeNode<T extends FlatComment> {
  comment: T
  children: TreeNode<T>[]
  depth: number
}

function compareCreatedAt<T extends FlatComment>(
  a: TreeNode<T>,
  b: TreeNode<T>,
): number {
  if (a.comment.created_at < b.comment.created_at) return -1
  if (a.comment.created_at > b.comment.created_at) return 1
  return 0
}

export function buildCommentTree<T extends FlatComment>(
  flat: ReadonlyArray<T>,
): TreeNode<T>[] {
  // Build a node for every input row up front so children can attach in
  // either insertion order.
  const byId = new Map<string, TreeNode<T>>()
  for (const c of flat) {
    byId.set(c.id, { comment: c, children: [], depth: 1 })
  }

  const roots: TreeNode<T>[] = []
  for (const c of flat) {
    const node = byId.get(c.id)
    if (!node) continue
    const parentId = c.parent_comment_id
    const parent = parentId == null ? null : byId.get(parentId) ?? null
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Sort siblings (and roots) by created_at ASC, then walk the tree to
  // assign depths from the roots down. Doing depth in a second pass means
  // an orphan-promoted-to-root correctly starts at depth 1 regardless of
  // where it lived in the input.
  function sortAndAssignDepth(nodes: TreeNode<T>[], depth: number) {
    nodes.sort(compareCreatedAt)
    for (const n of nodes) {
      n.depth = depth
      if (n.children.length > 0) {
        sortAndAssignDepth(n.children, depth + 1)
      }
    }
  }
  sortAndAssignDepth(roots, 1)

  return roots
}
