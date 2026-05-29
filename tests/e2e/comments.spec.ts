/**
 * Phase 7 threaded comments — E2E tests
 *
 * Auth strategy: same E2E shim as publish.spec.ts / post-page.spec.ts.
 *   - header `x-e2e-auth: 1` activates the bypass inside `lib/auth.ts`.
 *   - env `E2E_TEST_AUTH_USER_ID` sets the user ID the bypass returns.
 *
 * The shim only models ONE authed user. Multi-user scenarios (e.g.
 * "user A can't edit user B's comment") cannot be exercised without
 * a second auth shim or service-role helper; those are marked
 * `test.skip(true, ...)` with a documented gap.
 *
 * DB dependency: every test creates real rows via the public API and
 * relies on the Supabase service-role key being available to the dev
 * server. Tests are gated on `E2E_TEST_AUTH_USER_ID` so the suite
 * cleanly skips in CI when no E2E env is wired up.
 *
 * Navigation calls use `waitUntil: 'domcontentloaded'` to tolerate
 * the ViewBeacon's fire-and-forget fetch on the post page.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const HEADER_E2E_AUTH = { 'x-e2e-auth': '1' }

const HAS_E2E_AUTH = !!process.env.E2E_TEST_AUTH_USER_ID
const SKIP_REASON = 'requires E2E auth env (E2E_TEST_AUTH_USER_ID)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make `page` send the E2E auth shim header on every request.
 * Mirrors the helper used in post-page.spec.ts.
 */
async function signIn(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders(HEADER_E2E_AUTH)
}

/**
 * Create a fresh post via the API as the E2E user. Returns the
 * post id and its public URL so tests can navigate to it.
 */
async function createPost(
  request: APIRequestContext,
  suffix: string,
): Promise<{ id: string; url: string }> {
  const res = await request.post('/api/posts', {
    headers: HEADER_E2E_AUTH,
    data: {
      type: 'post',
      title: `E2E Comments Post ${suffix}`,
      summary: 'A sufficiently long summary that passes validation.',
      body_md: 'x'.repeat(60),
      tags: ['rag'],
    },
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { id: string; url: string }
  return { id: body.id, url: body.url }
}

/**
 * Post a top-level comment to `postId` via the API as the E2E user.
 * Returns the new comment id.
 */
async function createComment(
  request: APIRequestContext,
  postId: string,
  body: string,
  parentCommentId: string | null = null,
): Promise<string> {
  const res = await request.post('/api/comments', {
    headers: HEADER_E2E_AUTH,
    data: {
      post_id: postId,
      parent_comment_id: parentCommentId,
      body,
    },
  })
  expect(res.status()).toBe(201)
  const j = (await res.json()) as { id: string }
  return j.id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Phase 7 threaded comments', () => {
  // -------------------------------------------------------------------------
  // 1. Anonymous viewer sees comments + a "Sign in to comment" affordance
  // -------------------------------------------------------------------------
  test('anon viewer sees comments and "Sign in to comment" affordance', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const { id: postId, url } = await createPost(request, `anon-${suffix}`)
    const seededBody = `Seeded comment body ${suffix}`
    await createComment(request, postId, seededBody)

    // Anonymous visit — no auth header on the browser context
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    // The Comments section heading is present
    await expect(
      page.getByRole('heading', { name: /^\d+ Comments?$/i }),
    ).toBeVisible()

    // The seeded comment body renders
    await expect(page.locator('.comment__body').first()).toContainText(seededBody)

    // The "Sign in to comment" affordance is visible to anonymous viewers
    await expect(page.getByText(/sign in to comment/i)).toBeVisible()

    // The composer (textarea) is NOT rendered for anonymous viewers
    await expect(page.locator('.comment-form__textarea')).toHaveCount(0)
  })

  // -------------------------------------------------------------------------
  // 2. Authed top-level + reply via the UI
  // -------------------------------------------------------------------------
  test('authed user can post a top-level comment and a reply via the UI', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const { url } = await createPost(request, `ui-create-${suffix}`)

    await signIn(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    // --- Post a top-level comment via the root composer ---
    const topBody = `Top-level via UI ${suffix}`
    const rootForm = page.locator('.comment-thread__root-form')
    await rootForm.locator('.comment-form__textarea').fill(topBody)
    await rootForm.getByRole('button', { name: 'Post' }).click()

    // Optimistic insert: the new comment appears in the thread
    const newComment = page
      .locator('.comment')
      .filter({ has: page.locator('.comment__body', { hasText: topBody }) })
    await expect(newComment).toBeVisible()

    // --- Reply to that comment ---
    await newComment.getByRole('button', { name: 'Reply' }).click()

    const replyBody = `Reply via UI ${suffix}`
    const replyForm = newComment.locator('.comment__reply-form .comment-form')
    await replyForm.locator('.comment-form__textarea').fill(replyBody)
    await replyForm.getByRole('button', { name: 'Post' }).click()

    // The reply node is a descendant of the parent comment
    const reply = newComment
      .locator('.comment')
      .filter({ has: page.locator('.comment__body', { hasText: replyBody }) })
    await expect(reply).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 3. Edit own comment — body updates and "edited" indicator appears
  // -------------------------------------------------------------------------
  test('author can edit their own comment within the window', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const { id: postId, url } = await createPost(request, `edit-${suffix}`)
    const originalBody = `Original body ${suffix}`
    const commentId = await createComment(request, postId, originalBody)

    await signIn(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    const commentNode = page.locator(`.comment[data-comment-id="${commentId}"]`)
    await expect(commentNode).toBeVisible()

    // Click Edit on the comment (use the action button, scoped to this node)
    await commentNode
      .locator('.comment__actions')
      .getByRole('button', { name: 'Edit' })
      .click()

    // The edit textarea appears with the original body prefilled
    const editTextarea = commentNode.locator('.comment-form__textarea')
    await expect(editTextarea).toBeVisible()
    await expect(editTextarea).toHaveValue(originalBody)

    const editedBody = `Edited body ${suffix}`
    await editTextarea.fill(editedBody)
    await commentNode.getByRole('button', { name: 'Save' }).click()

    // The new body renders + the "(edited)" marker shows up
    await expect(commentNode.locator('.comment__body')).toContainText(editedBody)
    await expect(commentNode.locator('.comment__edited')).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // 4. Cannot edit others' comments
  // -------------------------------------------------------------------------
  // The E2E auth shim only supports ONE user (via E2E_TEST_AUTH_USER_ID), so
  // we cannot create a second authed identity to seed "user B"'s comment.
  // We document the gap with a forced skip; the underlying invariant
  // (Edit button only renders for `currentUserId === c.author_id`) is
  // covered by the CommentThread unit test in the vitest suite.
  // -------------------------------------------------------------------------
  test('Edit button is not shown on other users\' comments', async () => {
    test.skip(
      true,
      'E2E auth shim only supports a single user (E2E_TEST_AUTH_USER_ID). ' +
        'Multi-user scenario covered by CommentThread unit tests; revisit ' +
        'when a second-user fixture or service-role helper is wired up.',
    )
  })

  // -------------------------------------------------------------------------
  // 5. Soft-delete preserves children
  // -------------------------------------------------------------------------
  test('deleting a parent comment preserves its children with a removed placeholder', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const { id: postId, url } = await createPost(request, `soft-delete-${suffix}`)

    const parentBody = `Parent comment ${suffix}`
    const parentId = await createComment(request, postId, parentBody)

    const childBody = `Child comment ${suffix}`
    const childId = await createComment(request, postId, childBody, parentId)

    await signIn(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    const parentNode = page.locator(`.comment[data-comment-id="${parentId}"]`)
    const childNode = page.locator(`.comment[data-comment-id="${childId}"]`)
    await expect(parentNode).toBeVisible()
    await expect(childNode).toBeVisible()

    // Accept the confirm dialog the Delete button triggers
    page.once('dialog', (dialog) => dialog.accept())

    await parentNode
      .locator('.comment__actions')
      .getByRole('button', { name: /^Delete$/ })
      .click()

    // Parent body is replaced with the "[removed by author]" placeholder
    const removedBody = parentNode.locator('.comment__body--removed')
    await expect(removedBody).toBeVisible()
    await expect(removedBody).toContainText(/removed by author/i)

    // Original parent body text is gone
    await expect(parentNode.locator('.comment__body')).not.toContainText(
      parentBody,
    )

    // The child is still present and renders its original body
    await expect(childNode).toBeVisible()
    await expect(childNode.locator('.comment__body').first()).toContainText(
      childBody,
    )
  })

  // -------------------------------------------------------------------------
  // 6. comment_count surfaces in the post header after posting
  // -------------------------------------------------------------------------
  test('comment_count surfaces in the post header after the first comment', async ({
    page,
    request,
  }) => {
    test.skip(!HAS_E2E_AUTH, SKIP_REASON)

    const suffix = String(Date.now())
    const { url } = await createPost(request, `count-${suffix}`)

    // Fresh post: header should read "0 comments"
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.post-meta')).toContainText('0 comments')

    // Sign in, post one comment via the UI
    await signIn(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    const body = `Count check body ${suffix}`
    const rootForm = page.locator('.comment-thread__root-form')
    await rootForm.locator('.comment-form__textarea').fill(body)
    await rootForm.getByRole('button', { name: 'Post' }).click()

    // Wait for the optimistic comment to render so we know the POST resolved
    await expect(
      page.locator('.comment__body', { hasText: body }),
    ).toBeVisible()

    // Reload (clears the route cache because we just mutated) and check the
    // header now reads "1 comment" — driven by posts.comment_count trigger.
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.post-meta')).toContainText('1 comment')
  })
})
