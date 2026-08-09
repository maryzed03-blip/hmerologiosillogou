import nodemailer from "nodemailer";

const ACTION_LABELS = {
  create: "Νέα καταχώριση",
  update: "Επεξεργασία καταχώρισης",
  delete: "Ακύρωση κράτησης",
};

function clean(value, maxLength = 2000) {
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

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const gmailUser = clean(process.env.GMAIL_USER, 320);
  const gmailAppPassword = clean(process.env.GMAIL_APP_PASSWORD, 100).replaceAll(" ", "");
  const notifyTo = clean(process.env.NOTIFY_TO || gmailUser, 320);

  if (!gmailUser || !gmailAppPassword || !notifyTo) {
    console.error("EMAIL_CONFIG_MISSING", {
      hasUser: Boolean(gmailUser),
      hasPassword: Boolean(gmailAppPassword),
      hasRecipient: Boolean(notifyTo),
    });
    return response.status(500).json({
      error: "Email service is not configured",
      code: "EMAIL_CONFIG_MISSING",
    });
  }

  const body = request.body ?? {};
  const action = clean(body.action, 20);
  if (!Object.hasOwn(ACTION_LABELS, action)) {
    return response.status(400).json({ error: "Invalid action", code: "INVALID_ACTION" });
  }

  const bookingDate = clean(body.booking_date, 20);
  const therapistName = clean(body.therapist_name, 200);
  const additionalCoordinatorName = clean(body.additional_coordinator_name, 200);
  const coordinators = [therapistName, additionalCoordinatorName].filter(Boolean).join(" & ");
  const actionTime = clean(body.action_time, 100) || "Δεν έχει συμπληρωθεί";
  const topic = clean(body.topic, 500) || "Δεν έχει συμπληρωθεί";
  const description = clean(body.description, 3000) || "Δεν έχει συμπληρωθεί";
  const activityCategory = clean(body.activity_category, 80);
  const generalPrice = clean(body.general_price, 40);
  const offersMemberDiscount = body.offers_member_discount === true;
  const memberPrice = clean(body.member_price, 40);
  const requestedPublic = body.requested_public === true;
  const approvalStatus = clean(body.approval_status, 30);
  const publicStatus = body.is_public === true ? "Ναι" : "Όχι";

  if (!bookingDate || therapistName.length < 2) {
    return response.status(400).json({ error: "Missing required fields", code: "INVALID_PAYLOAD" });
  }

  const actionLabel = ACTION_LABELS[action];
  const formattedDate = formatGreekDate(bookingDate);
  const changedAt = new Intl.DateTimeFormat("el-GR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Athens",
  }).format(new Date());

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const categoryLabel =
    activityCategory === "association_free"
      ? "Δωρεάν Δράση Συλλόγου"
      : activityCategory === "therapist_independent"
        ? "Ανεξάρτητη Δράση Θεραπευτή Συλλόγου"
        : "Δράση Συλλόγου";

  const pendingApproval = requestedPublic && approvalStatus === "pending";
  const subject = pendingApproval
    ? `ΠΡΟΣ ΕΓΚΡΙΣΗ — ${topic} — ${formattedDate}`
    : `${actionLabel} — ${formattedDate}`;
  const text = [
    `Ενέργεια: ${actionLabel}`,
    `Ημερομηνία δράσης: ${formattedDate}`,
    `Συντονιστές: ${coordinators}`,
    `Ώρα: ${actionTime}`,
    `Θέμα: ${topic}`,
    `Περιγραφή: ${description}`,
    `Κατηγορία: ${categoryLabel}`,
    `Γενική τιμή: ${activityCategory === "association_free" ? "Δωρεάν" : (generalPrice ? `${generalPrice} €` : "Δεν ορίστηκε")}`,
    `Ειδική τιμή Μελών/Φίλων: ${offersMemberDiscount && memberPrice ? `${memberPrice} €` : "Όχι"}`,
    `Αίτημα δημόσιας εμφάνισης: ${requestedPublic ? "Ναι" : "Όχι"}`,
    `Κατάσταση έγκρισης: ${approvalStatus || "draft"}`,
    `Εμφάνιση στο δημόσιο πρόγραμμα: ${publicStatus}`,
    `Η αλλαγή καταγράφηκε: ${changedAt}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto">
      <h2 style="margin:0 0 18px">${escapeHtml(actionLabel)}</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 0;font-weight:700;width:190px">Ημερομηνία δράσης</td><td>${escapeHtml(formattedDate)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Συντονιστές</td><td>${escapeHtml(coordinators)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Ώρα</td><td>${escapeHtml(actionTime)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Θέμα</td><td>${escapeHtml(topic)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700;vertical-align:top">Περιγραφή</td><td>${escapeHtml(description).replaceAll("\n", "<br>")}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Κατηγορία</td><td>${escapeHtml(categoryLabel)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Γενική τιμή</td><td>${escapeHtml(activityCategory === "association_free" ? "Δωρεάν" : (generalPrice ? `${generalPrice} €` : "Δεν ορίστηκε"))}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Τιμή Μελών / Φίλων</td><td>${escapeHtml(offersMemberDiscount && memberPrice ? `${memberPrice} €` : "Δεν προσφέρεται")}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Αίτημα δημοσίευσης</td><td>${requestedPublic ? "Ναι" : "Όχι"}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Κατάσταση έγκρισης</td><td>${escapeHtml(approvalStatus || "draft")}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Δημόσιο πρόγραμμα</td><td>${escapeHtml(publicStatus)}</td></tr>
      </table>
      ${pendingApproval ? `
        <div style="margin-top:22px;padding:16px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0">
          <strong>Η δράση περιμένει έγκριση.</strong><br>
          <a href="https://hmerologiosillogou.vercel.app/manage" style="display:inline-block;margin-top:10px;color:#047857;font-weight:700">
            Άνοιγμα διαχείρισης για έγκριση →
          </a>
        </div>` : ""}
      <p style="margin-top:20px;color:#667085;font-size:13px">Η αλλαγή καταγράφηκε: ${escapeHtml(changedAt)}</p>
    </div>`;

  try {
    const info = await transporter.sendMail({
      from: `"Ημερολόγιο Συλλόγου" <${gmailUser}>`,
      to: notifyTo,
      subject,
      text,
      html,
    });

    console.log("EMAIL_SENT", { messageId: info.messageId, action, bookingDate });
    return response.status(200).json({ ok: true });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "EMAIL_SEND_FAILED";
    const command = typeof error === "object" && error && "command" in error ? String(error.command) : undefined;
    console.error("EMAIL_SEND_FAILED", { code, command, message: error instanceof Error ? error.message : String(error) });
    return response.status(500).json({ error: "Email delivery failed", code });
  }
}
