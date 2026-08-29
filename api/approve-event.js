import nodemailer from "nodemailer";
import { getAccessRole, getDocument, updateDocument } from "../lib/firestore-rest.js";

function clean(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendApprovalEmail(current, eventId) {
  const recipient = clean(current?.therapist_email, 220);
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient) || !user || !pass) return false;

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    const topic = clean(current?.topic, 300) || "Δράση Σ.Ε.ΨΥ.G.";
    const date = clean(current?.booking_date, 20) || eventId;
    await transporter.sendMail({
      from: `Σ.Ε.ΨΥ.G. <${user}>`,
      to: recipient,
      subject: `Εγκρίθηκε η δράση σου για ${date}`,
      text: `Η δράση «${topic}» εγκρίθηκε από τον Σύλλογο και δημοσιεύτηκε για την ημερομηνία ${date}.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.65"><h2 style="color:#174B49">Η δράση εγκρίθηκε</h2><p>Η δράση <strong>«${escapeHtml(topic)}»</strong> εγκρίθηκε από τον Σύλλογο και δημοσιεύτηκε για την ημερομηνία <strong>${escapeHtml(date)}</strong>.</p><p>Μπορείς να επιστρέψεις στην Περιοχή Θεραπευτών για να δεις ή να ενημερώσεις τα στοιχεία της.</p></div>`,
    });
    return true;
  } catch (error) {
    console.error("EVENT_APPROVAL_EMAIL_FAILED", error);
    return false;
  }
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

    const approvalEmailSent = await sendApprovalEmail(current, eventId);
    return response.status(200).json({ ok: true, approvalEmailSent });
  } catch (error) {
    const errorCode = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "APPROVAL_FAILED";
    console.error("EVENT_APPROVAL_FAILED", errorCode, error);
    return response.status(500).json({ error: "Approval failed", code: errorCode });
  }
}
