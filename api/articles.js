import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  createDocument,
  deleteDocument,
  getAccessRole,
  getDocument,
  queryCollection,
  updateDocument,
} from "../lib/firestore-rest.js";

const COLLECTION = "articles";

function clean(value, max = 5000) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function normalizeName(value) {
  return clean(value, 180)
    .toLocaleLowerCase("el-GR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:()"'’`´\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function articlePayload(document) {
  const data = document?.data || {};

  return {
    id: document?.id || "",
    title: clean(data.title, 300),
    excerpt: clean(data.excerpt, 1200),
    content: clean(data.content, 50000),

    cover_image_url: clean(
      data.cover_image_url,
      700000
    ),

    author_name: clean(
      data.author_name,
      180
    ),

    author_role: clean(
      data.author_role,
      260
    ),

    author_photo_url: clean(
      data.author_photo_url,
      700000
    ),

    owner_name: clean(
      data.owner_name || data.author_name,
      180
    ),

    approval_status:
      data.approval_status === "approved"
        ? "approved"
        : "pending",

    is_public:
      data.approval_status === "approved",

    created_at:
      data.created_at ||
      document?.createTime ||
      null,

    updated_at:
      data.updated_at ||
      document?.updateTime ||
      null,
  };
}

function canManageArticle(
  role,
  actorName,
  document
) {
  // Η Διοίκηση μπορεί να διαχειρίζεται όλα τα άρθρα.
  if (role === "admin") {
    return true;
  }

  if (role !== "member") {
    return false;
  }

  const actor = normalizeName(actorName);

  if (!actor) {
    return false;
  }

  const data = document?.data || {};

  /*
   * Νέα άρθρα:
   * χρησιμοποιούμε owner_name.
   *
   * Παλιά άρθρα:
   * αν δεν υπάρχει owner_name,
   * χρησιμοποιούμε το author_name.
   */
  const owner = normalizeName(
    data.owner_name || data.author_name
  );

  return Boolean(
    owner &&
    actor === owner
  );
}

async function sendArticleNotice(
  article,
  role
) {
  const user =
    process.env.GMAIL_USER;

  const pass =
    process.env.GMAIL_APP_PASSWORD;

  const to =
    process.env.NOTIFY_TO || user;

  if (!user || !pass || !to) {
    return;
  }

  try {
    const transporter =
      nodemailer.createTransport({
        service: "gmail",

        auth: {
          user,
          pass,
        },
      });

    const status =
      role === "admin"
        ? "Δημοσιεύτηκε"
        : "Αναμένει έγκριση";

    await transporter.sendMail({
      from:
        `Σ.Ε.ΨΥ.G. <${user}>`,

      to,

      subject:
        `Νέο άρθρο: ${article.title}`,

      text:
        `Νέο άρθρο από ${article.author_name}\n\n` +
        `Τίτλος: ${article.title}\n` +
        `Κατάσταση: ${status}`,

      html:
        `<div style="font-family:Arial,sans-serif;line-height:1.6">` +
        `<h2>Νέο άρθρο</h2>` +
        `<p><strong>Συγγραφέας:</strong> ${escapeHtml(article.author_name)}</p>` +
        `<p><strong>Τίτλος:</strong> ${escapeHtml(article.title)}</p>` +
        `<p><strong>Κατάσταση:</strong> ${escapeHtml(status)}</p>` +
        `</div>`,
    });
  } catch (error) {
    console.error(
      "Article email failed",
      error
    );
  }
}

export default async function handler(
  request,
  response
) {
  try {

    /*
     * ==========================
     * GET — Φόρτωση άρθρων
     * ==========================
     */

    if (request.method === "GET") {
      response.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
      );

      const code = clean(
        request.query?.code,
        100
      );

      const role =
        code
          ? getAccessRole(code)
          : null;

      const documents =
        await queryCollection(
          COLLECTION
        );

      const articles =
        documents
          .map(articlePayload)

          /*
           * Δημόσια:
           * μόνο εγκεκριμένα.
           *
           * Portal / Διοίκηση:
           * βλέπουν και pending.
           */
          .filter(
            (item) =>
              role
                ? true
                : item.approval_status ===
                  "approved"
          )

          .sort(
            (a, b) =>
              String(
                b.created_at || ""
              ).localeCompare(
                String(
                  a.created_at || ""
                )
              )
          );

      return response
        .status(200)
        .json({
          ok: true,
          role,
          articles,
        });
    }

    /*
     * ==========================
     * POST — Νέο άρθρο
     * ==========================
     */

    if (request.method === "POST") {
      const body =
        request.body || {};

      const role =
        getAccessRole(
          clean(
            body.code,
            100
          )
        );

      if (!role) {
        return response
          .status(401)
          .json({
            error:
              "Invalid code",

            code:
              "INVALID_MANAGE_CODE",
          });
      }

      const title =
        clean(
          body.title,
          300
        );

      const authorName =
        clean(
          body.author_name,
          180
        );

      /*
       * Το member_name είναι το όνομα
       * με το οποίο έχει μπει ο χρήστης.
       *
       * Αν δεν υπάρχει,
       * χρησιμοποιούμε author_name.
       */
      const actorName =
        clean(
          body.member_name,
          180
        ) || authorName;

      const content =
        clean(
          body.content,
          50000
        );

      if (
        title.length < 3 ||
        authorName.length < 2 ||
        content.length < 10
      ) {
        return response
          .status(400)
          .json({
            error:
              "Missing required article fields",

            code:
              "ARTICLE_FIELDS_REQUIRED",
          });
      }

      const now =
        new Date()
          .toISOString();

      const article = {
        title,

        excerpt:
          clean(
            body.excerpt,
            1200
          ),

        content,

        cover_image_url:
          clean(
            body.cover_image_url,
            700000
          ),

        author_name:
          authorName,

        author_role:
          clean(
            body.author_role,
            260
          ),

        author_photo_url:
          clean(
            body.author_photo_url,
            700000
          ),

        /*
         * Αυτό είναι το όνομα
         * του πραγματικού δημιουργού.
         */
        owner_name:
          actorName,

        /*
         * Η Διοίκηση δημοσιεύει
         * κατευθείαν.
         *
         * Τα μέλη περιμένουν έγκριση.
         */
        approval_status:
          role === "admin"
            ? "approved"
            : "pending",

        is_public:
          role === "admin",

        created_at:
          now,

        updated_at:
          now,
      };

      const id =
        `article-${Date.now()}-` +
        crypto
          .randomUUID()
          .slice(0, 8);

      const created =
        await createDocument(
          COLLECTION,
          id,
          article
        );

      await sendArticleNotice(
        article,
        role
      );

      return response
        .status(201)
        .json({
          ok: true,
          role,

          article:
            articlePayload(
              created
            ),
        });
    }

    /*
     * ==========================
     * PATCH
     * Έγκριση ή επεξεργασία
     * ==========================
     */

    if (request.method === "PATCH") {
      const body =
        request.body || {};

      const code =
        clean(
          body.code,
          100
        );

      const role =
        getAccessRole(code);

      if (!role) {
        return response
          .status(401)
          .json({
            error:
              "Invalid code",

            code:
              "INVALID_MANAGE_CODE",
          });
      }

      const id =
        clean(
          body.id,
          240
        );

      if (!id) {
        return response
          .status(400)
          .json({
            error:
              "Article id required",

            code:
              "ARTICLE_ID_REQUIRED",
          });
      }

      const current =
        await getDocument(
          COLLECTION,
          id
        );

      if (!current) {
        return response
          .status(404)
          .json({
            error:
              "Article not found",

            code:
              "ARTICLE_NOT_FOUND",
          });
      }

      const action =
        clean(
          body.action,
          30
        ) || "approve";

      const actorName =
        clean(
          body.member_name,
          180
        );

      /*
       * ======================
       * Έγκριση άρθρου
       * μόνο από Διοίκηση
       * ======================
       */

      if (action === "approve") {
        if (role !== "admin") {
          return response
            .status(403)
            .json({
              error:
                "Admin access required",

              code:
                "ADMIN_REQUIRED",
            });
        }

        const updated =
          await updateDocument(
            COLLECTION,
            id,
            {
              approval_status:
                "approved",

              is_public:
                true,

              updated_at:
                new Date()
                  .toISOString(),
            }
          );

        return response
          .status(200)
          .json({
            ok: true,

            article:
              articlePayload(
                updated
              ),
          });
      }

      /*
       * ======================
       * Επεξεργασία άρθρου
       * ======================
       */

      if (action !== "update") {
        return response
          .status(400)
          .json({
            error:
              "Invalid article action",

            code:
              "INVALID_ARTICLE_ACTION",
          });
      }

      /*
       * Επιτρέπεται:
       * - στη Διοίκηση
       * - στον δημιουργό
       */
      if (
        !canManageArticle(
          role,
          actorName,
          current
        )
      ) {
        return response
          .status(403)
          .json({
            error:
              "Article owner or admin required",

            code:
              "ARTICLE_OWNER_REQUIRED",
          });
      }

      const title =
        clean(
          body.title,
          300
        );

      const authorName =
        clean(
          body.author_name,
          180
        );

      const content =
        clean(
          body.content,
          50000
        );

      if (
        title.length < 3 ||
        authorName.length < 2 ||
        content.length < 10
      ) {
        return response
          .status(400)
          .json({
            error:
              "Missing required article fields",

            code:
              "ARTICLE_FIELDS_REQUIRED",
          });
      }

      const currentData =
        current.data || {};

      const updated =
        await updateDocument(
          COLLECTION,
          id,
          {
            title,

            excerpt:
              clean(
                body.excerpt,
                1200
              ),

            content,

            cover_image_url:
              clean(
                body.cover_image_url,
                700000
              ),

            author_name:
              authorName,

            author_role:
              clean(
                body.author_role,
                260
              ),

            author_photo_url:
              clean(
                body.author_photo_url,
                700000
              ),

            /*
             * Δεν αλλάζουμε ιδιοκτήτη
             * όταν γίνεται edit.
             */
            owner_name:
              clean(
                currentData.owner_name ||
                currentData.author_name,
                180
              ),

            /*
             * Η επεξεργασία δεν αλλάζει
             * την υπάρχουσα έγκριση.
             */
            approval_status:
              currentData
                .approval_status ===
              "approved"
                ? "approved"
                : "pending",

            is_public:
              currentData
                .approval_status ===
              "approved",

            updated_at:
              new Date()
                .toISOString(),
          }
        );

      return response
        .status(200)
        .json({
          ok: true,
          role,

          article:
            articlePayload(
              updated
            ),
        });
    }

    /*
     * ==========================
     * DELETE — Διαγραφή άρθρου
     * ==========================
     */

    if (request.method === "DELETE") {
      const body =
        request.body || {};

      const code =
        clean(
          body.code ||
          request.query?.code,
          100
        );

      const role =
        getAccessRole(code);

      if (!role) {
        return response
          .status(401)
          .json({
            error:
              "Invalid code",

            code:
              "INVALID_MANAGE_CODE",
          });
      }

      const id =
        clean(
          body.id ||
          request.query?.id,
          240
        );

      if (!id) {
        return response
          .status(400)
          .json({
            error:
              "Article id required",

            code:
              "ARTICLE_ID_REQUIRED",
          });
      }

      const current =
        await getDocument(
          COLLECTION,
          id
        );

      if (!current) {
        return response
          .status(404)
          .json({
            error:
              "Article not found",

            code:
              "ARTICLE_NOT_FOUND",
          });
      }

      const actorName =
        clean(
          body.member_name ||
          request.query?.member_name,
          180
        );

      /*
       * Διαγραφή:
       * - Διοίκηση → όλα
       * - Δημιουργός → μόνο δικά του
       */
      if (
        !canManageArticle(
          role,
          actorName,
          current
        )
      ) {
        return response
          .status(403)
          .json({
            error:
              "Article owner or admin required",

            code:
              "ARTICLE_OWNER_REQUIRED",
          });
      }

      await deleteDocument(
        COLLECTION,
        id
      );

      return response
        .status(200)
        .json({
          ok: true,
        });
    }

    response.setHeader(
      "Allow",
      "GET, POST, PATCH, DELETE"
    );

    return response
      .status(405)
      .json({
        error:
          "Method not allowed",

        code:
          "METHOD_NOT_ALLOWED",
      });

  } catch (error) {
    console.error(
      "Articles API error",
      error
    );

    return response
      .status(500)
      .json({
        error:
          error?.message ||
          "Articles operation failed",

        code:
          error?.code ||
          "ARTICLES_FAILED",
      });
  }
}
