import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createDocument, getDocument } from "../lib/firestore-rest.js";

function clean(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function todayInGreece() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
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

function parseFixedPaymentAmount(value) {
  const raw = clean(String(value ?? ""), 80);
  if (!raw) return 0;
  // Automatic payment is only enabled for an unambiguous fixed amount,
  // e.g. "30", "30€", "30,50 €". Free-text such as "Από 135€" is display-only.
  const compact = raw.replace(/\s+/g, "").replace(/€/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(compact)) return 0;
  const amount = Number(compact.replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function paymentAmount(event, membershipStatus) {
  if (event.activity_category === "association_free") return 0;
  const general = parseFixedPaymentAmount(event.general_price);
  const member = parseFixedPaymentAmount(event.member_price);
  if (event.offers_member_discount === true && member > 0 && ["member", "friend"].includes(membershipStatus)) return member;
  return general;
}

function publicBaseUrl(request) {
  const configured = clean(process.env.PUBLIC_APP_URL, 500).replace(/\/$/, "");
  if (configured) return configured;
  const host = clean(request.headers?.["x-forwarded-host"] || request.headers?.host, 300);
  const proto = clean(request.headers?.["x-forwarded-proto"], 20) || "https";
  return host ? `${proto}://${host}` : "";
}

function membershipLabel(value) {
  if (value === "friend") return "Φίλος του Συλλόγου";
  if (value === "member") return "Μέλος του Συλλόγου";
  if (value === "want_member") return "Θέλει να γίνει Μέλος του Συλλόγου";
  return "Δεν είναι Μέλος ή Φίλος";
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
  const membershipStatus = clean(body.membershipStatus, 60);
  const comment = clean(body.comment, 1000);
  const consent = body.consent === true;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(eventId) ||
    fullName.length < 2 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.length < 6 ||
    profession.length < 2 ||
    !["none", "friend", "member", "want_member"].includes(membershipStatus) ||
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
    if (event.is_public !== true || event.status === "completed" || eventId < todayInGreece()) {
      return response.status(409).json({ error: "Event is not open for registrations", code: "EVENT_NOT_OPEN" });
    }

    const registrationId = makeRegistrationId(eventId, email);
    const existing = await getDocument("eventRegistrations", registrationId);
    if (existing) {
      return response.status(409).json({ error: "Already registered", code: "ALREADY_REGISTERED" });
    }

    const amount = paymentAmount(event, membershipStatus);
    const paymentToken = amount > 0 ? crypto.randomBytes(24).toString("hex") : "";
    const paymentReference = amount > 0 ? `SEP-${eventId.replaceAll("-", "")}-${registrationId.slice(-8).toUpperCase()}` : "";

    const registration = {
      event_id: eventId,
      event_date: eventId,
      event_topic: clean(event.topic, 500) || "Δράση Συλλόγου",
      event_time: clean(event.action_time, 100),
      event_location: clean(event.location, 220),
      full_name: fullName,
      email,
      phone,
      profession,
      membership_status: membershipStatus,
      comment,
      consent: true,
      payment_amount: amount,
      payment_token: paymentToken || null,
      payment_reference: paymentReference || null,
      payment_status: amount > 0 ? "awaiting_declaration" : "not_required",
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
      const eventLocation = registration.event_location || "Δεν έχει οριστεί";
      const adminSubject = `Νέα συμμετοχή — ${eventTopic} — ${fullName}`;
      const adminHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:700px;margin:auto">
          <h2>Νέα δήλωση συμμετοχής</h2>
          <p><strong>Δράση:</strong> ${escapeHtml(eventTopic)}</p>
          <p><strong>Ημερομηνία:</strong> ${escapeHtml(formattedDate)}</p>
          <p><strong>Ώρα:</strong> ${escapeHtml(eventTime)}</p>
          <p><strong>Τοποθεσία:</strong> ${escapeHtml(eventLocation)}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
          <p><strong>Ονοματεπώνυμο:</strong> ${escapeHtml(fullName)}</p>
          <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
          <p><strong>Τηλέφωνο:</strong> ${escapeHtml(phone)}</p>
          <p><strong>Επάγγελμα:</strong> ${escapeHtml(profession)}</p>
          <p><strong>Σχέση με Σύλλογο:</strong> ${escapeHtml(membershipLabel(membershipStatus))}</p>
          <p><strong>Σχόλιο:</strong> ${comment ? escapeHtml(comment).replaceAll("\n", "<br>") : "—"}</p>
        </div>`;

      const confirmationSubject = `Επιβεβαίωση συμμετοχής — ${eventTopic}`;
      const baseUrl = publicBaseUrl(request);
      const declarationUrl = amount > 0 && paymentToken && baseUrl
        ? `${baseUrl}/api/declare-payment?token=${encodeURIComponent(paymentToken)}`
        : "";
      const paymentInstructions = clean(process.env.PAYMENT_INSTRUCTIONS, 2000);
      const paymentBlock = declarationUrl
        ? `<div style="margin:24px 0;padding:20px;border:1px solid #d8d0c4;border-radius:12px;background:#f4efe7">
            <p style="margin:0 0 10px"><strong>Ποσό συμμετοχής: ${escapeHtml(String(amount))} €</strong></p>
            ${paymentInstructions ? `<p style="margin:0 0 10px">${escapeHtml(paymentInstructions).replaceAll("\n", "<br>")}</p>` : ""}
            <p style="margin:0 0 16px"><strong>Αιτιολογία κατάθεσης:</strong> ${escapeHtml(paymentReference)}</p>
            <p style="margin:0 0 16px">Αφού πραγματοποιήσετε την κατάθεση, πατήστε το παρακάτω κουμπί. Η δήλωση θα εμφανιστεί στον Ταμία για επιβεβαίωση.</p>
            <a href="${escapeHtml(declarationUrl)}" style="display:inline-block;background:#244533;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">Έκανα την κατάθεση</a>
          </div>`
        : "";
      const confirmationHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:700px;margin:auto">
          <h2>Η συμμετοχή σας καταχωρίστηκε</h2>
          <p>Αγαπητέ/ή ${escapeHtml(fullName)},</p>
          <p>Λάβαμε τη δήλωση συμμετοχής σας για τη δράση:</p>
          <p><strong>${escapeHtml(eventTopic)}</strong><br>${escapeHtml(formattedDate)}<br>${escapeHtml(eventTime)}<br>📍 ${escapeHtml(eventLocation)}</p>
          ${paymentBlock}
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
