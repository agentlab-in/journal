-- =============================================================================
-- 0005_avatars_bucket.sql — add `avatars` storage bucket for Phase 6 profiles
--
-- Phase 6 introduces the settings page, which needs to upload user avatars via
-- the existing /api/uploads route. That route uses validateBucket() to gate
-- writes against an allowlist. We mirror the `covers` bucket setup: public read,
-- authenticated upload, owner-only delete, 2MB cap, same image MIME allowlist.
--
-- Idempotent: re-running locally (e.g. `supabase db reset`) is safe.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('avatars', 'avatars', true, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- storage.objects RLS — mirror the `covers` policies for the new bucket.
-- Wrapped in DROP IF EXISTS so re-applying the migration locally is safe.

DROP POLICY IF EXISTS "avatars: public read" ON storage.objects;
CREATE POLICY "avatars: public read"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars: authenticated upload" ON storage.objects;
CREATE POLICY "avatars: authenticated upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars: owner delete" ON storage.objects;
CREATE POLICY "avatars: owner delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'avatars' AND owner = auth.uid());
