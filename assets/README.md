# assets/

Vendored binary assets read at runtime by Next.js routes.

`JetBrainsMono-Regular.ttf` is JetBrains Mono Regular (OFL 1.1).
Upstream: <https://github.com/JetBrains/JetBrainsMono>.

It is vendored because the per-post OG route
(`app/[username]/[type]/[slug]/opengraph-image.tsx`) hands it to
Satori inside `ImageResponse`, which does not accept WOFF2 or
Google Fonts CDN URLs — TTF bytes from disk is the supported path.
