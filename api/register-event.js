import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createDocument, getDocument } from "../lib/firestore-rest.js";

function clean(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatGreekDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Athens",
  }).format(new Date(`${year}-${month}-${day}T12:00:00+03:00`));
}

function makeRegistrationId(eventId, email) {
  const digest = crypto.createHash("sha256").update(`${eventId}|${email}`).digest("hex").slice(0, 32);
  return `${eventId}_${digest}`;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const body = request.body ?? {};
  const website = clean(body.website, 300);
  if (website) return response.status(200).json({ ok: true });

  const eventId = clean(body.eventId, 20);
  const fullName = clean(body.fullName, 160);
  const email = clean(body.email, 220).toLowerCase();
  const phone = clean(body.phone, 60);
  const profession = clean(body.profession, 160);
  const comment = clean(body.comment, 1000);
  const consent = body.consent === true;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(eventId) ||
    fullName.length < 2 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.length < 6 ||
    profession.length < 2 ||
    !consent
  ) {
    return response.status(400).json({ error: "Invalid form data", code: "INVALID_PAYLOAD" });
  }

  try {
    const eventDocument = await getDocument("bookings", eventId);

    if (!eventDocument) {
      return response.status(404).json({ error: "Event not found", code: "EVENT_NOT_FOUND" });
    }

    const event = eventDocument.data ?? {};
    if (event.is_public !== true || event.status === "completed") {
      return response.status(409).json({ error: "Event is not open for registrations", code: "EVENT_NOT_OPEN" });
    }

    const registrationId = makeRegistrationId(eventId, email);
    const existing = await getDocument("eventRegistrations", registrationId);
    if (existing) {
      return response.status(409).json({ error: "Already registered", code: "ALREADY_REGISTERED" });
    }

    const registration = {
      event_id: eventId,
      event_date: eventId,
      event_topic: clean(event.topic, 500) || "Δράση Συλλόγου",
      event_time: clean(event.action_time, 100),
      full_name: fullName,
      email,
      phone,
      profession,
      comment,
      consent: true,
      created_at: new Date(),
    };

    await createDocument("eventRegistrations", registrationId, registration);

    const gmailUser = clean(process.env.GMAIL_USER, 320);
    const gmailAppPassword = clean(process.env.GMAIL_APP_PASSWORD, 100).replaceAll(" ", "");
    const notifyTo = clean(process.env.NOTIFY_TO || gmailUser, 320);
    let emailWarning = null;

    if (gmailUser && gmailAppPassword && notifyTo) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailAppPassword },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      });

      const formattedDate = formatGreekDate(eventId);
      const eventTopic = registration.event_topic;
      const eventTime = registration.event_time || "Η ώρα θα ανακοινωθεί";
      const adminSubject = `Νέα συμμετοχή — ${eventTopic} — ${fullName}`;
      const adminHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:700px;margin:auto">
          <h2>Νέα δήλωση συμμετοχής</h2>
          <p><strong>Δράση:</strong> ${escapeHtml(eventTopic)}</p>
          <p><strong>Ημερομηνία:</strong> ${escapeHtml(formattedDate)}</p>
          <p><strong>Ώρα:</strong> ${escapeHtml(eventTime)}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
          <p><strong>Ονοματεπώνυμο:</strong> ${escapeHtml(fullName)}</p>
          <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
          <p><strong>Τηλέφωνο:</strong> ${escapeHtml(phone)}</p>
          <p><strong>Επάγγελμα:</strong> ${escapeHtml(profession)}</p>
          <p><strong>Σχόλιο:</strong> ${comment ? escapeHtml(comment).replaceAll("\n", "<br>") : "—"}</p>
        </div>`;

      const confirmationSubject = `Επιβεβαίωση συμμετοχής — ${eventTopic}`;
      const confirmationHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:700px;margin:auto">
          <h2>Η συμμετοχή σας καταχωρίστηκε</h2>
          <p>Αγαπητέ/ή ${escapeHtml(fullName)},</p>
          <p>Λάβαμε τη δήλωση συμμετοχής σας για τη δράση:</p>
          <p><strong>${escapeHtml(eventTopic)}</strong><br>${escapeHtml(formattedDate)}<br>${escapeHtml(eventTime)}</p>
          <p>Ο Σύλλογος θα επικοινωνήσει μαζί σας εφόσον χρειάζονται επιπλέον πληροφορίες.</p>
        </div>`;

      try {
        await transporter.sendMail({
          from: `"Συμμετοχές Δράσεων" <${gmailUser}>`,
          to: notifyTo,
          replyTo: email,
          subject: adminSubject,
          html: adminHtml,
        });
        await transporter.sendMail({
          from: `"Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.Ψ.Υ.G" <${gmailUser}>`,
          to: email,
          subject: confirmationSubject,
          html: confirmationHtml,
        });
      } catch (mailError) {
        emailWarning = typeof mailError === "object" && mailError && "code" in mailError
          ? String(mailError.code)
          : "EMAIL_SEND_FAILED";
        console.error("EVENT_REGISTRATION_EMAIL_FAILED", emailWarning, mailError);
      }
    } else {
      emailWarning = "EMAIL_CONFIG_MISSING";
    }

    return response.status(201).json({ ok: true, emailWarning });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "REGISTRATION_FAILED";
    console.error("EVENT_REGISTRATION_FAILED", code, error);
    return response.status(500).json({ error: "Registration failed", code });
  }
}
