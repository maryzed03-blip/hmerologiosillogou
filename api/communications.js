import newsletterSignup from "../server-handlers/newsletter-signup.js";
import sendFriendRequest from "../server-handlers/send-friend-request.js";

function resourceFrom(request) {
  const value = request?.query?.resource;
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function handler(request, response) {
  const resource = resourceFrom(request);

  if (resource === "newsletter-signup") {
    return newsletterSignup(request, response);
  }

  if (resource === "send-friend-request") {
    return sendFriendRequest(request, response);
  }

  return response.status(404).json({ error: "Unknown communications endpoint", code: "NOT_FOUND" });
}
