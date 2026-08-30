import nodemailer from "nodemailer";

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

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const gmailUser = clean(process.env.GMAIL_USER, 320);
  const gmailAppPassword = clean(process.env.GMAIL_APP_PASSWORD, 100).replaceAll(" ", "");
  const notifyTo = clean(process.env.NOTIFY_TO || gmailUser, 320);

  if (!gmailUser || !gmailAppPassword || !notifyTo) {
    return response.status(500).json({ error: "Email service is not configured", code: "EMAIL_CONFIG_MISSING" });
  }

  const body = request.body ?? {};
  const website = clean(body.website, 300);
  if (website) {
    // Honeypot: behave like a successful submission without sending spam.
    return response.status(200).json({ ok: true });
  }

  const fullName = clean(body.fullName, 160);
  const email = clean(body.email, 220).toLowerCase();
  const phone = clean(body.phone, 60);
  const profession = clean(body.profession, 160);

  if (
    fullName.length < 2 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.length < 6 ||
    profession.length < 2
  ) {
    return response.status(400).json({ error: "Invalid form data", code: "INVALID_PAYLOAD" });
  }

  const submittedAt = new Intl.DateTimeFormat("el-GR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Athens",
  }).format(new Date());

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const subject = `Νέο ενδιαφέρον — Φίλος του Συλλόγου — ${fullName}`;
  const text = [
    "Νέα εκδήλωση ενδιαφέροντος για εγγραφή ως Φίλος του Συλλόγου",
    `Ονοματεπώνυμο: ${fullName}`,
    `Email: ${email}`,
    `Τηλέφωνο: ${phone}`,
    `Επάγγελμα: ${profession}`,
    `Υποβλήθηκε: ${submittedAt}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto">
      <h2 style="margin:0 0 18px">Νέα εκδήλωση ενδιαφέροντος</h2>
      <p>Ένα άτομο συμπλήρωσε τη φόρμα <strong>«Γίνε Φίλος του Συλλόγου»</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <tr><td style="padding:8px 0;font-weight:700;width:170px">Ονοματεπώνυμο</td><td>${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Τηλέφωνο</td><td>${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Επάγγελμα</td><td>${escapeHtml(profession)}</td></tr>
      </table>
      <p style="margin-top:20px;color:#667085;font-size:13px">Υποβλήθηκε: ${escapeHtml(submittedAt)}</p>
    </div>`;

  try {
    const info = await transporter.sendMail({
      from: `"Φίλοι Συλλόγου" <${gmailUser}>`,
      to: notifyTo,
      replyTo: email,
      subject,
      text,
      html,
    });

    console.log("FRIEND_REQUEST_EMAIL_SENT", { messageId: info.messageId, email });
    return response.status(200).json({ ok: true });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "EMAIL_SEND_FAILED";
    console.error("FRIEND_REQUEST_EMAIL_FAILED", {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    return response.status(500).json({ error: "Email delivery failed", code });
  }
}
