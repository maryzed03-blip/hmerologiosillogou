# Vercel Hobby deployment safety fix

This version keeps only 8 top-level JavaScript files in `/api`.

Five existing public API URLs are preserved with Vercel rewrites and are dispatched through one `/api/actions` function:
- `/api/approve-event`
- `/api/move-event`
- `/api/verify-manage-code`
- `/api/send-notification`
- `/api/send-friend-request`

The original handler implementations were moved to `lib/api-handlers/`, which Vercel bundles as dependencies but does not count as separate top-level Serverless Functions.

The existing `/api/newsletter-signup` compatibility rewrite is also preserved.
