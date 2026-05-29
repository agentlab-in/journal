/**
 * Convenience re-export: admin client is the same as the server (service-role) client.
 * Kept as a separate entry point so import paths are semantically clear.
 */
export { createServerSupabaseClient as createAdminSupabaseClient } from './server'
