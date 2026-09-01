import { getAccessRole, queryCollection } from "../lib/firestore-rest.js";

function clean(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }
  const code = clean(request.query?.code, 120);
  if (getAccessRole(code) !== "admin") return response.status(403).json({ error: "Administrator access required" });

  try {
    const items = await queryCollection("paymentDeclarations");
    const declarations = items.map((item) => ({ id: item.id, ...(item.data || {}) }))
      .sort((a, b) => String(b.declared_at || "").localeCompare(String(a.declared_at || "")));
    return response.status(200).json({ declarations });
  } catch (error) {
    console.error("PAYMENT_DECLARATIONS_FAILED", error);
    return response.status(500).json({ error: "Could not load payment declarations" });
  }
}
