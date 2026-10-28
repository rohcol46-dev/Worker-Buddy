# Vendored libraries

Served from this site instead of public CDNs, so the app keeps working if a CDN is slow or blocked,
and so the Content-Security-Policy in `vercel.json` can allow scripts from this site only.
Each file is copied unchanged from its npm package (the font from Google Fonts).

| File | npm package | Licence |
|---|---|---|
| `supabase-js-2.45.4/supabase.js`, `591.supabase.js` | `@supabase/supabase-js@2.45.4` (`dist/umd/`) | MIT |
| `leaflet-1.9.4/` | `leaflet@1.9.4` (`dist/`) | BSD-2-Clause |
| `qrcode-generator-1.4.4.js` | `qrcode-generator@1.4.4` (`qrcode.js`) | MIT |
| `jsqr-1.4.0.js` | `jsqr@1.4.0` (`dist/jsQR.js`) | Apache-2.0 |
| `fonts/plus-jakarta-sans-v12-latin.woff2` | Plus Jakarta Sans v12, latin subset, weights 500–800, from Google Fonts | SIL Open Font License 1.1 |

To update one: `npm pack <package>@<version>`, copy the same file here under a new versioned name,
update the `<script>` tags and the list in `sw.js`, and bump `VERSION` in `sw.js`.
