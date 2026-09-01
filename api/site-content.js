import crypto from "node:crypto";
import {
  createDocument,
  isValidAdminCode,
  queryCollection,
  updateDocument,
} from "../lib/firestore-rest.js";

const CONTENT_COLLECTION = "site_content";
const VERSIONS_COLLECTION = "site_content_versions";

function clean(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSectionKey(value) {
  const key = clean(value, 80).toLowerCase();
  return /^[a-z0-9_-]{1,80}$/.test(key) ? key : "";
}

function normalizeFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (count >= 80) break;
    const key = String(rawKey || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,80}$/.test(key)) continue;
    if (typeof rawValue !== "string") continue;
    output[key] = rawValue.slice(0, 350000);
    count += 1;
  }

  return output;
}

function parseFields(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return normalizeFields(JSON.parse(value));
  } catch {
    return {};
  }
}

function serializeFields(value) {
  return JSON.stringify(normalizeFields(value));
}

function publicSection(document) {
  const data = document?.data || {};
  return {
    id: document?.id || "",
    section_key: clean(data.section_key || document?.id, 80),
    label: clean(data.label, 160),
    fields: parseFields(data.published_json),
    published_at: data.published_at || null,
  };
}

function adminSection(document) {
  const data = document?.data || {};
  return {
    id: document?.id || "",
    section_key: clean(data.section_key || document?.id, 80),
    label: clean(data.label, 160),
    draft: parseFields(data.draft_json),
    published: parseFields(data.published_json),
    updated_at: data.updated_at || null,
    published_at: data.published_at || null,
    updated_by: clean(data.updated_by, 180),
  };
}

function adminVersion(document) {
  const data = document?.data || {};
  return {
    id: document?.id || "",
    section_key: clean(data.section_key, 80),
    label: clean(data.label, 160),
    fields: parseFields(data.fields_json),
    created_at: data.created_at || document?.createTime || null,
    created_by: clean(data.created_by, 180),
    action: clean(data.action, 40) || "publish",
  };
}

async function findSection(sectionKey) {
  const documents = await queryCollection(CONTENT_COLLECTION);
  return documents.find((item) => item?.id === sectionKey || clean(item?.data?.section_key, 80) === sectionKey) || null;
}

async function upsertSection(sectionKey, data) {
  const existing = await findSection(sectionKey);
  if (existing) return await updateDocument(CONTENT_COLLECTION, existing.id, data);
  return await createDocument(CONTENT_COLLECTION, sectionKey, {
    section_key: sectionKey,
    created_at: new Date().toISOString(),
    ...data,
  });
}

async function createVersion(sectionKey, label, fields, createdBy, action = "publish") {
  const now = new Date().toISOString();
  const id = `site-version-${sectionKey}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return await createDocument(VERSIONS_COLLECTION, id, {
    section_key: sectionKey,
    label,
    fields_json: serializeFields(fields),
    created_at: now,
    created_by: createdBy,
    action,
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (request.method === "OPTIONS") return response.status(204).end();

  try {
    if (request.method === "GET") {
      const code = clean(request.query?.code, 100);
      const sectionKey = normalizeSectionKey(request.query?.section);
      const isAdmin = code ? isValidAdminCode(code) : false;
      const documents = await queryCollection(CONTENT_COLLECTION);

      if (!isAdmin) {
        const published = documents.map(publicSection).filter((item) => item.section_key);
        if (sectionKey) {
          const section = published.find((item) => item.section_key === sectionKey) || null;
          return response.status(200).json({ ok: true, section });
        }
        const sections = Object.fromEntries(published.map((item) => [item.section_key, item]));
        return response.status(200).json({ ok: true, sections });
      }

      const versionsRaw = await queryCollection(VERSIONS_COLLECTION);
      const sections = documents.map(adminSection).filter((item) => item.section_key);
      const versions = versionsRaw
        .map(adminVersion)
        .filter((item) => item.section_key)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 120);

      return response.status(200).json({ ok: true, role: "admin", sections, versions });
    }

    if (request.method === "POST") {
      const body = request.body || {};
      const code = clean(body.code, 100);
      if (!isValidAdminCode(code)) {
        return response.status(403).json({ error: "Admin access required", code: "ADMIN_REQUIRED" });
      }

      const action = clean(body.action, 40);
      const sectionKey = normalizeSectionKey(body.section);
      const label = clean(body.label, 160) || sectionKey;
      const updatedBy = clean(body.updated_by, 180);
      if (!sectionKey) {
        return response.status(400).json({ error: "Valid section required", code: "SECTION_REQUIRED" });
      }

      const now = new Date().toISOString();

      if (action === "save_draft") {
        const fields = normalizeFields(body.fields);
        const updated = await upsertSection(sectionKey, {
          section_key: sectionKey,
          label,
          draft_json: serializeFields(fields),
          updated_at: now,
          updated_by: updatedBy,
        });
        return response.status(200).json({ ok: true, section: adminSection(updated) });
      }

      if (action === "publish") {
        const fields = normalizeFields(body.fields);
        const updated = await upsertSection(sectionKey, {
          section_key: sectionKey,
          label,
          draft_json: serializeFields(fields),
          published_json: serializeFields(fields),
          updated_at: now,
          published_at: now,
          updated_by: updatedBy,
        });
        await createVersion(sectionKey, label, fields, updatedBy, "publish");
        return response.status(200).json({ ok: true, section: adminSection(updated) });
      }

      if (action === "restore") {
        const versionId = clean(body.version_id, 240);
        if (!versionId) {
          return response.status(400).json({ error: "Version required", code: "VERSION_REQUIRED" });
        }

        const versions = await queryCollection(VERSIONS_COLLECTION);
        const versionDocument = versions.find((item) => item?.id === versionId) || null;
        const version = versionDocument ? adminVersion(versionDocument) : null;
        if (!version || version.section_key !== sectionKey) {
          return response.status(404).json({ error: "Version not found", code: "VERSION_NOT_FOUND" });
        }

        const restored = await upsertSection(sectionKey, {
          section_key: sectionKey,
          label: version.label || label,
          draft_json: serializeFields(version.fields),
          published_json: serializeFields(version.fields),
          updated_at: now,
          published_at: now,
          updated_by: updatedBy,
        });
        await createVersion(sectionKey, version.label || label, version.fields, updatedBy, "restore");
        return response.status(200).json({ ok: true, section: adminSection(restored) });
      }

      return response.status(400).json({ error: "Unknown action", code: "UNKNOWN_ACTION" });
    }

    response.setHeader("Allow", "GET, POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    console.error("Site content API error", error);
    return response.status(500).json({
      error: error?.message || "Site content operation failed",
      code: error?.code || "SITE_CONTENT_FAILED",
    });
  }
}
