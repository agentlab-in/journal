/**
 * Pre-hydration theme script — runs synchronously in <head> before React
 * mounts so the correct `data-theme` lands on <html> on the very first
 * paint. Without it, a returning dark-mode user briefly flashes the
 * system/default theme (FOUC) until <ThemeToggle> re-reads localStorage.
 *
 * Phase 13: localStorage key is `theme` (kept short so it reads cleanly
 * in devtools and isn't tied to the app's marketing name).
 *
 * Shared between `app/layout.tsx` (the root layout) and
 * `app/global-not-found.tsx` (the Next 16 globalNotFound page, which
 * owns its own <html> and would otherwise FOUC on dark-mode 404s).
 * Anywhere a page renders its own <html>/<head>, inline this string via
 * <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />.
 */
export const THEME_INIT_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`
