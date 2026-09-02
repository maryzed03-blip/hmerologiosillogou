import { queryCollection } from "../lib/firestore-rest.js";

function clean(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function plain(value, max = 1200) {
  return clean(value, max)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function todayInGreece() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function publicEvent(document) {
  const data = document?.data || {};
  const date = clean(data.booking_date || document?.id, 20);
  const category = clean(data.activity_category, 60);
  const price = clean(data.general_price, 120);
  return {
    id: document?.id || date,
    booking_date: date,
    topic: clean(data.topic, 300) || "Δράση Συλλόγου",
    description: plain(data.description, 1000),
    event_type: clean(data.event_type, 120),
    mode: clean(data.mode, 120),
    location: clean(data.location, 180),
    action_time: clean(data.action_time, 120),
    image_url: clean(data.image_url, 700000),
    activity_category: category,
    price: category === "association_free" ? "Δωρεάν" : price,
    detail_url: `https://hmerologiosillogou.vercel.app/events?event=${encodeURIComponent(date)}`,
  };
}

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  try {
    const rawLimit = Number.parseInt(String(request.query?.limit || "3"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(12, Math.max(1, rawLimit)) : 3;
    const today = todayInGreece();
    const documents = await queryCollection("bookings");
    const publicEvents = documents
      .filter((document) => {
        const data = document?.data || {};
        return data.is_public === true;
      })
      .map(publicEvent)
      .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.booking_date));

    const upcoming = publicEvents
      .filter((event) => event.booking_date >= today)
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date));

    const recentPast = publicEvents
      .filter((event) => event.booking_date < today)
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date));

    const events = [...upcoming, ...recentPast].slice(0, limit);
    return response.status(200).json({ ok: true, today, events });
  } catch (error) {
    console.error("Public events API error", error);
    return response.status(500).json({
      ok: false,
      error: error?.message || "Public events failed",
      code: error?.code || "PUBLIC_EVENTS_FAILED",
    });
  }
}
