import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  createDocument,
  deleteDocument,
  getAccessRole,
  getDocument,
  isValidAdminCode,
  queryCollection,
  updateDocument,
} from "../lib/firestore-rest.js";

const COLLECTION = "articles";

function clean(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function parsedBody(request) {
  if (request?.body && typeof request.body === "object") return request.body;
  if (typeof request?.body === "string") {
    try {
      return Object.fromEntries(new URLSearchParams(request.body));
    } catch {
      return {};
    }
  }
  return {};
}

function publicArticle(document) {
  const data = document?.data || {};
  return {
    id: document?.id || "",
    title: clean(data.title, 300),
    excerpt: clean(data.excerpt, 1200),
    content: clean(data.content, 50000),
    cover_image_url: clean(data.cover_image_url, 700000),
    author_name: clean(data.author_name, 180),
    author_role: clean(data.author_role, 260),
    author_photo_url: clean(data.author_photo_url, 700000),
    approval_status: data.approval_status === "approved" ? "approved" : "pending",
    // Public rule: approval by Administration is the single source of truth.
    // If an article is approved, it is public even when an older record still has is_public:false.
    is_public: data.approval_status === "approved",
    created_at: data.created_at || document?.createTime || null,
    updated_at: data.updated_at || document?.updateTime || null,
  };
}

function approvalSecret() {
  return String(
    process.env.ARTICLE_APPROVAL_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.GMAIL_APP_PASSWORD ||
    process.env.ADMIN_CODE ||
    ""
  );
}

function makeApprovalToken(id, createdAt) {
  const secret = approvalSecret();
  if (!secret || !id || !createdAt) return "";
  return crypto.createHmac("sha256", secret).update(`${id}|${createdAt}`).digest("base64url");
}

function validApprovalToken(id, createdAt, supplied) {
  const expected = makeApprovalToken(id, createdAt);
  const actual = clean(supplied, 500);
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicBaseUrl(request) {
  const configured = clean(process.env.PUBLIC_APP_URL, 500).replace(/\/$/, "");
  if (configured) return configured;
  const production = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL, 500).replace(/\/$/, "");
  if (production) return `https://${production}`;
  const host = clean(request?.headers?.["x-forwarded-host"] || request?.headers?.host, 300);
  const proto = clean(request?.headers?.["x-forwarded-proto"], 20) || "https";
  return host ? `${proto}://${host}` : "https://hmerologiosillogou.vercel.app";
}

function renderApprovalPage(response, { title, authorName, id, createdAt, token, alreadyApproved = false, error = "" }) {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  const safeTitle = escapeHtml(title || "Άρθρο");
  const safeAuthor = escapeHtml(authorName || "");
  const safeError = escapeHtml(error || "");
  if (error) {
    return response.status(403).send(`<!doctype html><html lang="el"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f7efe8;color:#263b39;padding:32px"><main style="max-width:620px;margin:auto;background:white;padding:28px;border-radius:18px"><h1 style="font-size:24px;color:#174b49">Δεν ήταν δυνατή η έγκριση</h1><p>${safeError}</p></main></body></html>`);
  }
  if (alreadyApproved) {
    return response.status(200).send(`<!doctype html><html lang="el"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f7efe8;color:#263b39;padding:32px"><main style="max-width:620px;margin:auto;background:white;padding:28px;border-radius:18px"><h1 style="font-size:24px;color:#174b49">Το άρθρο είναι ήδη εγκεκριμένο</h1><p><strong>${safeTitle}</strong></p>${safeAuthor ? `<p>${safeAuthor}</p>` : ""}</main></body></html>`);
  }
  return response.status(200).send(`<!doctype html><html lang="el"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f7efe8;color:#263b39;padding:32px"><main style="max-width:620px;margin:auto;background:white;padding:28px;border-radius:18px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#008d8b">Σ.Ε.ΨΥ.G. · ΕΓΚΡΙΣΗ ΑΡΘΡΟΥ</div><h1 style="font-size:26px;color:#174b49;margin-bottom:8px">${safeTitle}</h1>${safeAuthor ? `<p style="color:#647370">${safeAuthor}</p>` : ""}<p>Πάτησε το κουμπί μόνο εφόσον θέλεις το άρθρο να δημοσιευτεί στην ιστοσελίδα του Συλλόγου.</p><form method="post" action="/api/articles?action=approve-email"><input type="hidden" name="id" value="${escapeHtml(id)}"><input type="hidden" name="created_at" value="${escapeHtml(createdAt)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" style="border:0;border-radius:999px;background:#174b49;color:white;padding:13px 22px;font-weight:700;cursor:pointer">Έγκριση και δημοσίευση</button></form></main></body></html>`);
}

async function sendArticleNotice(article, role, articleId, request) {
  const user = clean(process.env.GMAIL_USER, 320);
  const pass = clean(process.env.GMAIL_APP_PASSWORD, 200).replaceAll(" ", "");
  const to = clean(process.env.NOTIFY_TO || user, 320);
  if (!user || !pass || !to) return false;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    const pending = role !== "admin";
    const status = pending ? "Αναμένει έγκριση" : "Δημοσιεύτηκε";
    const token = pending ? makeApprovalToken(articleId, article.created_at) : "";
    const approvalUrl = token
      ? `${publicBaseUrl(request)}/api/articles?action=approve&id=${encodeURIComponent(articleId)}&created_at=${encodeURIComponent(article.created_at)}&token=${encodeURIComponent(token)}`
      : "";
    const excerpt = clean(article.excerpt, 700);
    const approvalBlock = approvalUrl
      ? `<div style="margin-top:22px;padding:18px;border-radius:14px;background:#ecfdf5;border:1px solid #a7f3d0"><strong>Το άρθρο περιμένει έγκριση από τη Διοίκηση.</strong><br><a href="${escapeHtml(approvalUrl)}" style="display:inline-block;margin-top:12px;background:#174b49;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">Έλεγχος &amp; έγκριση άρθρου</a></div>`
      : "";
    await transporter.sendMail({
      from: `Σ.Ε.ΨΥ.G. <${user}>`,
      to,
      subject: pending ? `ΠΡΟΣ ΕΓΚΡΙΣΗ — ${article.title}` : `Νέο άρθρο — ${article.title}`,
      text: `Νέο άρθρο από ${article.author_name}\n\nΤίτλος: ${article.title}\nΚατάσταση: ${status}${approvalUrl ? `\n\nΈγκριση: ${approvalUrl}` : ""}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto"><h2 style="color:#174b49">Νέο άρθρο</h2><p><strong>Συγγραφέας:</strong> ${escapeHtml(article.author_name)}</p><p><strong>Τίτλος:</strong> ${escapeHtml(article.title)}</p>${excerpt ? `<p><strong>Σύντομη εισαγωγή:</strong><br>${escapeHtml(excerpt)}</p>` : ""}<p><strong>Κατάσταση:</strong> ${escapeHtml(status)}</p>${approvalBlock}</div>`,
    });
    return true;
  } catch (error) {
    console.error("Article email failed", error);
    return false;
  }
}

export default async function handler(request, response) {
  try {
    const action = clean(request.query?.action, 80);

    if (request.method === "GET" && action === "approve") {
      const id = clean(request.query?.id, 240);
      const createdAt = clean(request.query?.created_at, 120);
      const token = clean(request.query?.token, 500);
      if (!id || !createdAt || !token) {
        return renderApprovalPage(response, { title: "", authorName: "", id, createdAt, token, error: "Ο σύνδεσμος έγκρισης δεν είναι πλήρης." });
      }
      const document = await getDocument(COLLECTION, id);
      if (!document) {
        return renderApprovalPage(response, { title: "", authorName: "", id, createdAt, token, error: "Το άρθρο δεν βρέθηκε." });
      }
      const article = publicArticle(document);
      const storedCreatedAt = clean(document.data?.created_at, 120);
      if (storedCreatedAt !== createdAt || !validApprovalToken(id, createdAt, token)) {
        return renderApprovalPage(response, { title: article.title, authorName: article.author_name, id, createdAt, token, error: "Ο σύνδεσμος έγκρισης δεν είναι έγκυρος ή έχει αλλοιωθεί." });
      }
      return renderApprovalPage(response, { title: article.title, authorName: article.author_name, id, createdAt, token, alreadyApproved: article.approval_status === "approved" });
    }

    if (request.method === "POST" && action === "approve-email") {
      const body = parsedBody(request);
      const id = clean(body.id, 240);
      const createdAt = clean(body.created_at, 120);
      const token = clean(body.token, 500);
      const document = id ? await getDocument(COLLECTION, id) : null;
      const article = document ? publicArticle(document) : null;
      const storedCreatedAt = clean(document?.data?.created_at, 120);
      if (!document || !article || storedCreatedAt !== createdAt || !validApprovalToken(id, createdAt, token)) {
        return renderApprovalPage(response, { title: article?.title || "", authorName: article?.author_name || "", id, createdAt, token, error: "Ο σύνδεσμος έγκρισης δεν είναι έγκυρος ή έχει λήξει." });
      }
      if (article.approval_status !== "approved") {
        await updateDocument(COLLECTION, id, {
          approval_status: "approved",
          is_public: true,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(200).send(`<!doctype html><html lang="el"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f7efe8;color:#263b39;padding:32px"><main style="max-width:620px;margin:auto;background:white;padding:28px;border-radius:18px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#008d8b">Σ.Ε.ΨΥ.G.</div><h1 style="font-size:26px;color:#174b49">Το άρθρο εγκρίθηκε</h1><p><strong>${escapeHtml(article.title)}</strong> δημοσιεύτηκε στην ιστοσελίδα του Συλλόγου.</p><a href="${escapeHtml(publicBaseUrl(request))}/article/${encodeURIComponent(id)}" style="color:#008d8b;font-weight:700">Προβολή άρθρου →</a></main></body></html>`);
    }

    if (request.method === "GET") {
      response.setHeader("Cache-Control", "no-store, max-age=0");
      const code = clean(request.query?.code, 100);
      const role = code ? getAccessRole(code) : null;
      const documents = await queryCollection(COLLECTION);
      const articles = documents
        .map(publicArticle)
        .filter((item) => role ? true : item.approval_status === "approved")
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return response.status(200).json({ ok: true, role, articles });
    }

    if (request.method === "POST") {
      const body = parsedBody(request);
      const role = getAccessRole(clean(body.code, 100));
      if (!role) return response.status(401).json({ error: "Invalid code", code: "INVALID_MANAGE_CODE" });

      const title = clean(body.title, 300);
      const authorName = clean(body.author_name, 180);
      const content = clean(body.content, 50000);
      if (title.length < 3 || authorName.length < 2 || content.length < 10) {
        return response.status(400).json({ error: "Missing required article fields", code: "ARTICLE_FIELDS_REQUIRED" });
      }

      const now = new Date().toISOString();
      const article = {
        title,
        excerpt: clean(body.excerpt, 1200),
        content,
        cover_image_url: clean(body.cover_image_url, 700000),
        author_name: authorName,
        author_role: clean(body.author_role, 260),
        author_photo_url: clean(body.author_photo_url, 700000),
        approval_status: role === "admin" ? "approved" : "pending",
        is_public: role === "admin",
        created_at: now,
        updated_at: now,
      };

      const id = `article-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const created = await createDocument(COLLECTION, id, article);
      const emailSent = await sendArticleNotice(article, role, id, request);
      return response.status(201).json({ ok: true, role, article: publicArticle(created), emailSent });
    }

    if (request.method === "PATCH") {
      const body = parsedBody(request);
      const code = clean(body.code, 100);
      if (!isValidAdminCode(code)) {
        return response.status(403).json({ error: "Admin access required", code: "ADMIN_REQUIRED" });
      }
      const id = clean(body.id, 240);
      if (!id) return response.status(400).json({ error: "Article id required", code: "ARTICLE_ID_REQUIRED" });

      const updated = await updateDocument(COLLECTION, id, {
        approval_status: "approved",
        is_public: true,
        updated_at: new Date().toISOString(),
      });
      return response.status(200).json({ ok: true, article: publicArticle(updated) });
    }

    if (request.method === "DELETE") {
      const body = parsedBody(request);
      const code = clean(body.code || request.query?.code, 100);
      if (!isValidAdminCode(code)) {
        return response.status(403).json({ error: "Admin access required", code: "ADMIN_REQUIRED" });
      }
      const id = clean(body.id || request.query?.id, 240);
      if (!id) return response.status(400).json({ error: "Article id required", code: "ARTICLE_ID_REQUIRED" });
      await deleteDocument(COLLECTION, id);
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    console.error("Articles API error", error);
    return response.status(500).json({
      error: error?.message || "Articles operation failed",
      code: error?.code || "ARTICLES_FAILED",
    });
  }
}
