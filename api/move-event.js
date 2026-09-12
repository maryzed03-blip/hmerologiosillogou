// Keep /api/move-event as a stable public endpoint while sharing exactly the
// same implementation with the /api/actions?route=move-event fallback route.
export { default } from "../lib/api-handlers/move-event.js";
