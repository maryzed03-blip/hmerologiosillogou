import tls from "node:tls";

const ACTION_LABELS = {
  create: "Νέα καταχώριση",
  update: "Επεξεργασία καταχώρισης",
  delete: "Ακύρωση κράτησης",
};

function clean(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
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

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(value) {
  return value.replace(/(^|\r\n)\./g, "$1..");
}

function createResponseReader(socket) {
  let buffer = "";
  let currentLines = [];
  const ready = [];
  const waiters = [];

  function deliver(response) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(response);
    else ready.push(response);
  }

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      currentLines.push(line);
      if (/^\d{3} /.test(line)) {
        deliver(currentLines.join("\n"));
        currentLines = [];
      }
    }
  });

  socket.on("error", (error) => {
    while (waiters.length) waiters.shift().reject(error);
  });

  return function nextResponse(timeoutMs = 15000) {
    if (ready.length) return Promise.resolve(ready.shift());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const i = waiters.findIndex((item) => item.resolve === wrappedResolve);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error("SMTP response timeout"));
      }, timeoutMs);
      const wrappedResolve = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
      waiters.push({ resolve: wrappedResolve, reject });
    });
  };
}

function assertCode(response, allowedCodes) {
  const code = Number.parseInt(response.slice(0, 3), 10);
  if (!allowedCodes.includes(code)) {
    throw new Error(`SMTP error ${response}`);
  }
}

async function sendGmail({ user, appPassword, to, subject, text, html }) {
  const socket = tls.connect({
    host: "smtp.gmail.com",
    port: 465,
    servername: "smtp.gmail.com",
    rejectUnauthorized: true,
  });
  socket.setTimeout(20000, () => socket.destroy(new Error("SMTP connection timeout")));

  const nextResponse = createResponseReader(socket);
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  let response = await nextResponse();
  assertCode(response, [220]);

  async function command(value, expectedCodes) {
    socket.write(`${value}\r\n`);
    const reply = await nextResponse();
    assertCode(reply, expectedCodes);
    return reply;
  }

  try {
    await command("EHLO vercel.app", [250]);
    await command("AUTH LOGIN", [334]);
    await command(Buffer.from(user).toString("base64"), [334]);
    await command(Buffer.from(appPassword.replaceAll(" ", "")).toString("base64"), [235]);
    await command(`MAIL FROM:<${user}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", [354]);

    const boundary = `calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const message = [
      `From: ${encodeHeader("Ημερολόγιο Συλλόγου")} <${user}>`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    response = await nextResponse();
    assertCode(response, [250]);
    await command("QUIT", [221]);
  } finally {
    socket.end();
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return response.status(403).json({ error: "Invalid origin" });
      }
    } catch {
      return response.status(403).json({ error: "Invalid origin" });
    }
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  const notifyTo = process.env.NOTIFY_TO || gmailUser;

  if (!gmailUser || !gmailAppPassword || !notifyTo) {
    console.error("Missing Gmail environment variables");
    return response.status(500).json({ error: "Email service is not configured" });
  }

  const body = request.body ?? {};
  const action = clean(body.action, 20);
  if (!Object.hasOwn(ACTION_LABELS, action)) {
    return response.status(400).json({ error: "Invalid action" });
  }

  const bookingDate = clean(body.booking_date, 20);
  const therapistName = clean(body.therapist_name, 200);
  const actionTime = clean(body.action_time, 100) || "Δεν έχει συμπληρωθεί";
  const topic = clean(body.topic, 500) || "Δεν έχει συμπληρωθεί";
  const description = clean(body.description, 3000) || "Δεν έχει συμπληρωθεί";

  if (!bookingDate || therapistName.length < 2) {
    return response.status(400).json({ error: "Missing required fields" });
  }

  const actionLabel = ACTION_LABELS[action];
  const formattedDate = formatGreekDate(bookingDate);
  const changedAt = new Intl.DateTimeFormat("el-GR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Athens",
  }).format(new Date());

  const subject = `${actionLabel} — ${formattedDate}`;
  const text = [
    `Ενέργεια: ${actionLabel}`,
    `Ημερομηνία δράσης: ${formattedDate}`,
    `Θεραπευτής/ές: ${therapistName}`,
    `Ώρα: ${actionTime}`,
    `Θέμα: ${topic}`,
    `Περιγραφή: ${description}`,
    `Η αλλαγή καταγράφηκε: ${changedAt}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto">
      <h2 style="margin:0 0 18px">${escapeHtml(actionLabel)}</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 0;font-weight:700;width:190px">Ημερομηνία δράσης</td><td>${escapeHtml(formattedDate)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Θεραπευτής/ές</td><td>${escapeHtml(therapistName)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Ώρα</td><td>${escapeHtml(actionTime)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700">Θέμα</td><td>${escapeHtml(topic)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:700;vertical-align:top">Περιγραφή</td><td>${escapeHtml(description).replaceAll("\n", "<br>")}</td></tr>
      </table>
      <p style="margin-top:20px;color:#667085;font-size:13px">Η αλλαγή καταγράφηκε: ${escapeHtml(changedAt)}</p>
    </div>`;

  try {
    await sendGmail({
      user: gmailUser,
      appPassword: gmailAppPassword,
      to: notifyTo,
      subject,
      text,
      html,
    });
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error("Email notification failed", error);
    return response.status(500).json({ error: "Email delivery failed" });
  }
}
