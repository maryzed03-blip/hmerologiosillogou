import { getAccessRole } from "../firestore-rest.js";

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const role = getAccessRole(request.body?.code);
  if (!role) {
    return response.status(401).json({ error: "Invalid code", code: "INVALID_MANAGE_CODE" });
  }

  return response.status(200).json({ ok: true, role });
}
