import crypto from "node:crypto";
import {
  createDocument,
  deleteDocument,
  isValidAdminCode,
  queryCollection,
  updateDocument,
} from "../lib/firestore-rest.js";

const COLLECTION = "newsletter_subscribers";

function clean(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeEmail(value) {
  return clean(value, 240).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function subscriberId(email) {
  return `subscriber-${crypto.createHash("sha256").update(email).digest("hex").slice(0, 28)}`;
}

function serialize(document) {
  const data = document?.data || {};
  return {
    id: document?.id || "",
    email: normalizeEmail(data.email),
    active: data.active !== false,
    source: clean(data.source, 120),
    consent_at: clean(data.consent_at, 80) || null,
    created_at: clean(data.created_at, 80) || document?.createTime || null,
    updated_at: clean(data.updated_at, 80) || document?.updateTime || null,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (request.method === "OPTIONS") return response.status(204).end();

  try {
    if (request.method === "POST") {
      const email = normalizeEmail(request.body?.email);
      const consent = request.body?.consent === true;
      const source = clean(request.body?.source, 120) || "website";

      if (!isEmail(email)) {
        return response.status(400).json({ error: "Valid email required", code: "INVALID_EMAIL" });
      }
      if (!consent) {
        return response.status(400).json({ error: "Consent required", code: "CONSENT_REQUIRED" });
      }

      const id = subscriberId(email);
      const now = new Date().toISOString();
      const existing = (await queryCollection(COLLECTION)).find((item) => item.id === id || normalizeEmail(item.data?.email) === email) || null;

      if (existing) {
        await updateDocument(COLLECTION, existing.id, {
          email,
          active: true,
          source,
          consent_at: clean(existing.data?.consent_at, 80) || now,
          updated_at: now,
        });
        return response.status(200).json({ ok: true, alreadySubscribed: existing.data?.active !== false });
      }

      await createDocument(COLLECTION, id, {
        email,
        active: true,
        source,
        consent_at: now,
        created_at: now,
        updated_at: now,
      });
      return response.status(201).json({ ok: true, alreadySubscribed: false });
    }

    const code = request.method === "GET" ? request.query?.code : request.body?.code;
    if (!isValidAdminCode(clean(code, 100))) {
      return response.status(403).json({ error: "Admin access required", code: "ADMIN_REQUIRED" });
    }

    if (request.method === "GET") {
      const subscribers = (await queryCollection(COLLECTION))
        .map(serialize)
        .filter((item) => item.email && item.active)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return response.status(200).json({ ok: true, subscribers, total: subscribers.length });
    }

    if (request.method === "DELETE") {
      const id = clean(request.body?.id, 180);
      if (!id) return response.status(400).json({ error: "Subscriber required", code: "SUBSCRIBER_REQUIRED" });
      await deleteDocument(COLLECTION, id);
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    console.error("NEWSLETTER_SIGNUP_FAILED", error);
    return response.status(500).json({ error: "Newsletter operation failed", code: error?.code || "NEWSLETTER_FAILED" });
  }
}
