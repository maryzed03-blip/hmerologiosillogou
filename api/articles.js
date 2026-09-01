import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  createDocument,
  deleteDocument,
  getAccessRole,
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

async function sendArticleNotice(article, role) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_TO || user;
  if (!user || !pass || !to) return;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    const status = role === "admin" ? "Δημοσιεύτηκε" : "Αναμένει έγκριση";
    await transporter.sendMail({
      from: `Σ.Ε.ΨΥ.G. <${user}>`,
      to,
      subject: `Νέο άρθρο: ${article.title}`,
      text: `Νέο άρθρο από ${article.author_name}\n\nΤίτλος: ${article.title}\nΚατάσταση: ${status}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Νέο άρθρο</h2><p><strong>Συγγραφέας:</strong> ${escapeHtml(article.author_name)}</p><p><strong>Τίτλος:</strong> ${escapeHtml(article.title)}</p><p><strong>Κατάσταση:</strong> ${escapeHtml(status)}</p></div>`,
    });
  } catch (error) {
    console.error("Article email failed", error);
  }
}

export default async function handler(request, response) {
  try {
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
      const body = request.body || {};
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
      await sendArticleNotice(article, role);
      return response.status(201).json({ ok: true, role, article: publicArticle(created) });
    }

    if (request.method === "PATCH") {
      const body = request.body || {};
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
      const body = request.body || {};
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
