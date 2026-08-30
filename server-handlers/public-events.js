import { queryCollection } from "../lib/firestore-rest.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function todayInGreece() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function normalizeEvent(document) {
  const data = document?.data || {};
  return {
    id: document?.id || data.booking_date || "",
    booking_date: String(data.booking_date || document?.id || ""),
    topic: typeof data.topic === "string" ? data.topic : "",
    description: typeof data.description === "string" ? data.description : "",
    long_description: typeof data.long_description === "string" ? data.long_description : "",
    event_type: typeof data.event_type === "string" ? data.event_type : "",
    mode: typeof data.mode === "string" ? data.mode : "",
    location: typeof data.location === "string" ? data.location : "",
    action_time: typeof data.action_time === "string" ? data.action_time : "",
    image_url: typeof data.image_url === "string" ? data.image_url : "",
    activity_category:
      data.activity_category === "association_free"
        ? "association_free"
        : data.activity_category === "unity_institute"
          ? "unity_institute"
          : data.activity_category === "therapist_action" || data.activity_category === "therapist_independent"
            ? "therapist_action"
            : "association",
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const requestedLimit = Number.parseInt(String(req.query?.limit || "3"), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(12, Math.max(1, requestedLimit)) : 3;
    const today = todayInGreece();
    const documents = await queryCollection("bookings");

    const publicEvents = documents
      .filter((document) => {
        const data = document?.data || {};
        return data.is_public === true;
      })
      .map(normalizeEvent)
      .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.booking_date));

    const upcoming = publicEvents
      .filter((event) => event.booking_date >= today)
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date));

    const past = publicEvents
      .filter((event) => event.booking_date < today)
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date));

    res.status(200).json({
      ok: true,
      events: [...upcoming, ...past].slice(0, limit),
    });
  } catch (error) {
    console.error("public-events error", error);
    res.status(500).json({ ok: false, error: "Could not load public events" });
  }
}
