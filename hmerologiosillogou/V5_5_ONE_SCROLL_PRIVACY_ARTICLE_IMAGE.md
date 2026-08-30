# V5.5 — One-scroll popups, private share URLs, article image layout

- Public activity/article popups no longer expose copyable URLs.
- Share URLs are shown only in the therapist/admin portal, for the therapist's own content (admin can see all).
- Event approval email now falls back to the therapist directory in the Map when the booking itself does not already contain an email.
- Article feature image is centered inside the article instead of being used as a full-width banner; the title follows below it.
- Modal scrolling is reduced to one intentional internal scrollbar. The Carrd embeds receive `SEPSYG_MODAL_STATE` and lock the parent Carrd page while a popup is open.
- Use the matching V5.5 Carrd embed snippets for the one-scroll behavior.
