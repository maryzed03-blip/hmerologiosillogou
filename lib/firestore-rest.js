import crypto from "node:crypto";

let tokenCache = null;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    const error = new Error(`Missing environment variable: ${name}`);
    error.code = "FIREBASE_ADMIN_CONFIG_MISSING";
    throw error;
  }
  return value.trim();
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function normalizePrivateKey(rawValue) {
  let value = String(rawValue || "").trim();

  // Accept the whole downloaded service-account JSON by mistake.
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed.private_key === "string") value = parsed.private_key;
    } catch {
      // Continue with the other supported pasted formats.
    }
  }

  // Accept a copied JSON line such as: "private_key": "-----BEGIN...\n...",.
  const propertyMatch = value.match(/^["']?private_key["']?\s*:\s*([\s\S]+?)\s*,?$/);
  if (propertyMatch) value = propertyMatch[1].trim();

  // Accept a JSON string with surrounding double quotes and escaped newlines.
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  value = value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

  // Keep only the PEM block, removing accidental labels, quotes, or commas.
  const pemMatch = value.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
  if (!pemMatch) {
    const error = new Error(
      "FIREBASE_PRIVATE_KEY must contain the complete BEGIN PRIVATE KEY and END PRIVATE KEY block"
    );
    error.code = "FIREBASE_PRIVATE_KEY_INVALID";
    throw error;
  }

  const pem = `${pemMatch[0].replace(/\r\n/g, "\n").trim()}\n`;

  try {
    return crypto.createPrivateKey({ key: pem, format: "pem" });
  } catch (cause) {
    const error = new Error(
      "FIREBASE_PRIVATE_KEY is not a valid service-account private key. Copy the complete private_key value from the Firebase JSON file."
    );
    error.code = "FIREBASE_PRIVATE_KEY_INVALID";
    error.cause = cause;
    throw error;
  }
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const clientEmail = requiredEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("FIREBASE_PRIVATE_KEY"));
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payloadData = await response.json().catch(() => ({}));
  if (!response.ok || !payloadData.access_token) {
    const error = new Error(payloadData.error_description || "Could not obtain Google access token");
    error.code = "FIREBASE_ADMIN_AUTH_FAILED";
    throw error;
  }

  tokenCache = {
    token: payloadData.access_token,
    expiresAt: Date.now() + Number(payloadData.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

function projectId() {
  return requiredEnv("FIREBASE_PROJECT_ID");
}

function documentsBase() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId())}/databases/(default)/documents`;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])) } };
  }
  return { stringValue: String(value) };
}

function toFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFields(value.mapValue?.fields || {});
  return null;
}

function fromFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function parseDocument(document) {
  if (!document) return null;
  const parts = String(document.name || "").split("/");
  return {
    id: parts.at(-1) || "",
    data: fromFields(document.fields || {}),
    createTime: document.createTime || null,
    updateTime: document.updateTime || null,
  };
}

async function authorizedFetch(url, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return response;
}

export function getAccessRole(value) {
  if (typeof value !== "string") return null;
  const supplied = value.trim();
  const manageCode = (process.env.MANAGE_CODE || "1111").trim();
  const adminCode = (process.env.ADMIN_CODE || "2222").trim();

  if (supplied === adminCode) return "admin";
  if (supplied === manageCode) return "member";
  return null;
}

export function isValidManageCode(value) {
  return getAccessRole(value) !== null;
}

export function isValidAdminCode(value) {
  return getAccessRole(value) === "admin";
}

export async function getDocument(collectionId, documentId) {
  const response = await authorizedFetch(`${documentsBase()}/${encodeURIComponent(collectionId)}/${encodeURIComponent(documentId)}`);
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Firestore document read failed");
    error.code = payload.error?.status || `HTTP_${response.status}`;
    throw error;
  }
  return parseDocument(payload);
}

export async function createDocument(collectionId, documentId, data) {
  const url = `${documentsBase()}/${encodeURIComponent(collectionId)}/${encodeURIComponent(documentId)}?currentDocument.exists=false`;
  const response = await authorizedFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFields(data) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Firestore document creation failed");
    error.code = response.status === 409 ? "ALREADY_EXISTS" : (payload.error?.status || `HTTP_${response.status}`);
    throw error;
  }
  return parseDocument(payload);
}

export async function deleteDocument(collectionId, documentId) {
  const response = await authorizedFetch(`${documentsBase()}/${encodeURIComponent(collectionId)}/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error?.message || "Firestore document deletion failed");
    error.code = payload.error?.status || `HTTP_${response.status}`;
    throw error;
  }
}

export async function queryCollection(collectionId, fieldName = null, equalValue = null) {
  const structuredQuery = { from: [{ collectionId }] };
  if (fieldName) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: fieldName },
        op: "EQUAL",
        value: toFirestoreValue(equalValue),
      },
    };
  }
  const response = await authorizedFetch(`${documentsBase()}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
  const payload = await response.json().catch(() => ([]));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Firestore query failed");
    error.code = payload.error?.status || `HTTP_${response.status}`;
    throw error;
  }
  return payload.map((item) => parseDocument(item.document)).filter(Boolean);
}
