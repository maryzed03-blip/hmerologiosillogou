import { deleteDocument, getAccessRole, queryCollection } from "../lib/firestore-rest.js";

function clean(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function serializeRegistration(document) {
  const data = document.data ?? {};
  return {
    id: document.id,
    event_id: clean(data.event_id, 20),
    event_date: clean(data.event_date, 20),
    event_topic: clean(data.event_topic, 500),
    event_time: clean(data.event_time, 100),
    full_name: clean(data.full_name, 160),
    email: clean(data.email, 220),
    phone: clean(data.phone, 60),
    profession: clean(data.profession, 160),
    comment: clean(data.comment, 1000),
    created_at: clean(data.created_at, 80) || document.createTime || null,
  };
}

export default async function handler(request, response) {
  const code = request.method === "GET" ? request.query?.code : request.body?.code;
  const role = getAccessRole(code);
  if (!role) {
    return response.status(401).json({ error: "Invalid code", code: "INVALID_MANAGE_CODE" });
  }

  try {
    if (request.method === "GET") {
      const summary = request.query?.summary === "1";
      const eventId = clean(request.query?.eventId, 20);

      if (summary) {
        const documents = await queryCollection("eventRegistrations");
        const counts = {};
        for (const item of documents) {
          const id = clean(item.data?.event_id, 20);
          if (id) counts[id] = (counts[id] || 0) + 1;
        }
        return response.status(200).json({ counts });
      }

      if (role !== "admin") {
        return response.status(403).json({ error: "Administrator access required", code: "ADMIN_REQUIRED" });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventId)) {
        return response.status(400).json({ error: "Invalid event", code: "INVALID_EVENT" });
      }

      const documents = await queryCollection("eventRegistrations", "event_id", eventId);
      const registrations = documents
        .map(serializeRegistration)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return response.status(200).json({ registrations });
    }

    if (request.method === "DELETE") {
      if (role !== "admin") {
        return response.status(403).json({ error: "Administrator access required", code: "ADMIN_REQUIRED" });
      }

      const registrationId = clean(request.body?.registrationId, 120);
      if (!registrationId) {
        return response.status(400).json({ error: "Missing registration", code: "INVALID_REGISTRATION" });
      }
      await deleteDocument("eventRegistrations", registrationId);
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, DELETE");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const errorCode = typeof error === "object" && error && "code" in error ? String(error.code) : "REGISTRATIONS_FAILED";
    console.error("EVENT_REGISTRATIONS_FAILED", errorCode, error);
    return response.status(500).json({ error: "Could not load registrations", code: errorCode });
  }
}
