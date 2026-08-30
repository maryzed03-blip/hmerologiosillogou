# Carrd auto-height integration

This build sends its real document height to a Carrd parent page using postMessage.

Message sent by the app:
- `SEPSYG_EMBED_HEIGHT`
- `SEPSYG_EMBED_READY`

Message received from Carrd:
- `SEPSYG_PARENT_VIEWPORT`

Use the supplied `CARRD-EMBED-HMEROLOGIO-AUTOHEIGHT.txt` inside:
Carrd → Embed → Code → Inline

Do NOT use Carrd's normal IFRAME element for this version.
