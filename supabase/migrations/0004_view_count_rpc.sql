-- =============================================================================
-- Migration 0004 — View-count RPC
--
-- Adds an atomic increment function for posts.view_count. A plain UPDATE with
-- view_count = view_count + 1 cannot be expressed through the Supabase JS
-- client's .update() helper (which requires a literal value), so we expose a
-- small SECURITY DEFINER function instead. The function is intentionally
-- simple: no return value, no error raised when the post is missing (the
-- beacon is fire-and-forget and must never leak post existence).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_post_view_count(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.posts
    SET view_count = view_count + 1
    WHERE id = p_id
      AND deleted_at IS NULL;
END;
$$;

-- Grant execute to all roles that might call this through the API.
-- The function is harmless to anon (worst case: increments a public counter),
-- and service_role calls it from the server-side beacon route.
GRANT EXECUTE ON FUNCTION public.increment_post_view_count(uuid)
    TO anon, authenticated, service_role;
