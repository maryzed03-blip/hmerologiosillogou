import approveEvent from "../lib/api-handlers/approve-event.js";
import moveEvent from "../lib/api-handlers/move-event.js";
import verifyManageCode from "../lib/api-handlers/verify-manage-code.js";
import sendNotification from "../lib/api-handlers/send-notification.js";
import sendFriendRequest from "../lib/api-handlers/send-friend-request.js";

const handlers = {
  "approve-event": approveEvent,
  "move-event": moveEvent,
  "verify-manage-code": verifyManageCode,
  "send-notification": sendNotification,
  "send-friend-request": sendFriendRequest,
};

export default async function handler(request, response) {
  const rawRoute = request.query?.route;
  const route = Array.isArray(rawRoute) ? rawRoute[0] : String(rawRoute || "").trim();
  const target = handlers[route];

  if (!target) {
    return response.status(404).json({
      error: "API route not found",
      code: "API_ROUTE_NOT_FOUND",
    });
  }

  return await target(request, response);
}
