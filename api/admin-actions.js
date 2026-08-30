import verifyManageCode from "../server-handlers/verify-manage-code.js";
import approveEvent from "../server-handlers/approve-event.js";
import moveEvent from "../server-handlers/move-event.js";

function resourceFrom(request) {
  const value = request?.query?.resource;
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function handler(request, response) {
  const resource = resourceFrom(request);

  if (resource === "verify-manage-code") {
    return verifyManageCode(request, response);
  }

  if (resource === "approve-event") {
    return approveEvent(request, response);
  }

  if (resource === "move-event") {
    return moveEvent(request, response);
  }

  return response.status(404).json({ error: "Unknown administration endpoint", code: "NOT_FOUND" });
}
