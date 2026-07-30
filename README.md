# Personal Life Assistant

Private everything-calendar PWA for Matthew R. Moreira.
Cloudflare Workers + D1 + static PWA. See CLAUDE.md for the full brain/spec.

## Quick start
npm install && npx wrangler login && npm run db:schema && npm run db:seed
Set secrets (see CLAUDE.md), then: npm run deploy

## Apple Notes -> app (iPhone Shortcuts recipe)
1. Shortcuts app -> new Shortcut "Push Notes":
   Find Notes (modified today) -> Repeat: Get Contents of URL
   POST https://matthew-r-moreira-mypersonallifeassistant.ca/api/notes-inbox
   Header: Authorization = Bearer <NOTES_INBOX_TOKEN>; JSON body: title, body.
2. Calendar app: recurring hourly event "Notes Sync" on a dedicated calendar.
3. Shortcuts -> Automation -> Calendar event starts "Notes Sync" -> Run "Push
   Notes" -> Run Immediately. (This is the hourly-trigger workaround.)
