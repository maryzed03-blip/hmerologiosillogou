import crypto from "node:crypto";
import { createDocument, getDocument, queryCollection, updateDocument } from "../lib/firestore-rest.js";

function clean(value, maxLength = 1000) {
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

function page({ title, body, token = "", canSubmit = false }) {
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f2f0ea;color:#25372c;font-family:Arial,sans-serif}.wrap{max-width:620px;margin:40px auto;padding:20px}.card{background:#fbfaf6;border:1px solid #d8d0c4;border-radius:18px;overflow:hidden}.head{padding:28px;background:linear-gradient(135deg,#244533,#56755f);color:#fff;text-align:center}.content{padding:28px;line-height:1.7}.btn{border:0;background:#244533;color:#fff;padding:13px 22px;border-radius:999px;font-weight:700;font-size:15px;cursor:pointer}.note{font-size:13px;color:#626b65}</style></head><body><div class="wrap"><div class="card"><div class="head"><strong>Σ.Ε.ΨΥ.G.</strong><br><span>Δήλωση κατάθεσης</span></div><div class="content"><h2>${escapeHtml(title)}</h2>${body}${canSubmit ? `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button class="btn" type="submit">Επιβεβαιώνω ότι έκανα την κατάθεση</button></form><p class="note">Η δήλωση δεν σημαίνει αυτόματη επιβεβαίωση πληρωμής. Ο Ταμίας θα ελέγξει την κατάθεση.</p>` : ""}</div></div></div></body></html>`;
}

async function registrationByToken(token) {
  const matches = await queryCollection("eventRegistrations", "payment_token", token);
  return matches[0] || null;
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).send("Method not allowed");
  }

  const token = clean(request.method === "GET" ? request.query?.token : request.body?.token, 120);
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return response.status(400).send(page({ title: "Ο σύνδεσμος δεν είναι έγκυρος", body: "<p>Χρησιμοποιήστε το κουμπί που λάβατε στο email επιβεβαίωσης.</p>" }));
  }

  try {
    const registration = await registrationByToken(token);
    if (!registration) return response.status(404).send(page({ title: "Η συμμετοχή δεν βρέθηκε", body: "<p>Δεν βρέθηκε ενεργή συμμετοχή για αυτόν τον σύνδεσμο.</p>" }));
    const data = registration.data || {};
    const amount = Number(data.payment_amount || 0);
    if (!(amount > 0)) return response.status(409).send(page({ title: "Δεν απαιτείται πληρωμή", body: "<p>Η συγκεκριμένη δράση δεν έχει οικονομική εκκρεμότητα.</p>" }));

    const eventId = clean(data.event_id, 20);
    const eventDoc = eventId ? await getDocument("bookings", eventId) : null;
    const topic = clean(data.event_topic || eventDoc?.data?.topic, 500) || "Δράση Συλλόγου";
    const fullName = clean(data.full_name, 160);

    if (request.method === "GET") {
      return response.status(200).send(page({
        title: "Έκανα την κατάθεση",
        token,
        canSubmit: true,
        body: `<p><strong>${escapeHtml(fullName)}</strong></p><p>${escapeHtml(topic)}<br><strong>${escapeHtml(String(amount))} €</strong></p><p>Πατήστε το κουμπί μόνο αφού έχετε πραγματοποιήσει την κατάθεση.</p>`,
      }));
    }

    const declarationId = `decl_${crypto.createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
    const existing = await getDocument("paymentDeclarations", declarationId);
    if (!existing) {
      await createDocument("paymentDeclarations", declarationId, {
        registration_id: registration.id,
        event_id: eventId,
        event_topic: topic,
        event_date: clean(data.event_date, 20) || eventId,
        event_time: clean(data.event_time, 100),
        full_name: fullName,
        email: clean(data.email, 220).toLowerCase(),
        membership_status: clean(data.membership_status, 60),
        payment_reference: clean(data.payment_reference, 100),
        amount,
        status: "declared",
        declared_at: new Date(),
      });
    }
    await updateDocument("eventRegistrations", registration.id, {
      payment_status: "declared",
      payment_declared_at: new Date(),
    });

    return response.status(200).send(page({
      title: "Η δήλωση στάλθηκε στο Ταμείο",
      body: `<p>Ευχαριστούμε, <strong>${escapeHtml(fullName)}</strong>.</p><p>Η δήλωση κατάθεσης για <strong>${escapeHtml(topic)}</strong> καταχωρίστηκε. Ο Ταμίας θα ελέγξει την πραγματική κατάθεση και μετά θα ολοκληρωθεί η πληρωμή.</p>`,
    }));
  } catch (error) {
    console.error("DECLARE_PAYMENT_FAILED", error);
    return response.status(500).send(page({ title: "Δεν ολοκληρώθηκε η δήλωση", body: "<p>Δοκιμάστε ξανά από το ίδιο κουμπί αργότερα.</p>" }));
  }
}
