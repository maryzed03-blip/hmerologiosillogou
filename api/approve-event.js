import { getAccessRole, getDocument, updateDocument } from "../lib/firestore-rest.js";

function clean(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const code = clean(request.body?.code, 100);
  if (getAccessRole(code) !== "admin") {
    return response.status(403).json({ error: "Administrator access required", code: "ADMIN_REQUIRED" });
  }

  const eventId = clean(request.body?.eventId, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventId)) {
    return response.status(400).json({ error: "Invalid event", code: "INVALID_EVENT" });
  }

  try {
    const eventDocument = await getDocument("bookings", eventId);
    if (!eventDocument) {
      return response.status(404).json({ error: "Event not found", code: "EVENT_NOT_FOUND" });
    }

    const current = eventDocument.data ?? {};
    if (current.requested_public !== true && current.approval_status !== "pending") {
      return response.status(409).json({ error: "Event is not pending approval", code: "NOT_PENDING" });
    }

    await updateDocument("bookings", eventId, {
      requested_public: true,
      approval_status: "approved",
      is_public: true,
      approved_at: new Date(),
    });

    return response.status(200).json({ ok: true });
  } catch (error) {
    const errorCode = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "APPROVAL_FAILED";
    console.error("EVENT_APPROVAL_FAILED", errorCode, error);
    return response.status(500).json({ error: "Approval failed", code: errorCode });
  }
}
