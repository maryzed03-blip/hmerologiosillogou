import {
  commitMutations,
  getAccessRole,
  getDocument,
  queryCollection
} from "../lib/firestore-rest.js";

function clean(value, max = 120) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");

    return response.status(405).json({
      ok: false,
      code: "METHOD_NOT_ALLOWED"
    });
  }

  const code = clean(
    request.body?.code,
    20
  );

  const role = getAccessRole(code);

  if (!role) {
    return response.status(401).json({
      ok: false,
      code: "INVALID_CODE"
    });
  }

  const eventId = clean(
    request.body?.eventId,
    20
  );

  const targetDate = clean(
    request.body?.targetDate,
    20
  );

  const datePattern =
    /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(eventId) ||
    !datePattern.test(targetDate)
  ) {
    return response.status(400).json({
      ok: false,
      code: "INVALID_DATE"
    });
  }

  if (eventId === targetDate) {
    return response.status(400).json({
      ok: false,
      code: "SAME_DATE"
    });
  }

  if (
    targetDate < "2026-07-01" ||
    targetDate > "2027-08-31"
  ) {
    return response.status(400).json({
      ok: false,
      code: "DATE_OUT_OF_RANGE"
    });
  }

  try {
    const current =
      await getDocument(
        "bookings",
        eventId
      );

    if (!current) {
      return response.status(404).json({
        ok: false,
        code: "EVENT_NOT_FOUND"
      });
    }

    const target =
      await getDocument(
        "bookings",
        targetDate
      );

    if (target) {
      return response.status(409).json({
        ok: false,
        code: "TARGET_DATE_OCCUPIED"
      });
    }


    const declarations =
      await queryCollection(
        "paymentDeclarations",
        "event_id",
        eventId
      ).catch(() => []);

    const movedBooking = {
      ...current.data,
      booking_date: targetDate,
      updated_at: new Date()
    };

    const operations = [
      {
        type: "create",
        collectionId: "bookings",
        documentId: targetDate,
        data: movedBooking
      },

      ...declarations.map((item) => ({
        type: "update",
        collectionId: "paymentDeclarations",
        documentId: item.id,
        data: {
          event_id: targetDate,
          event_date: targetDate
        }
      })),

      {
        type: "delete",
        collectionId: "bookings",
        documentId: eventId
      }
    ];

    await commitMutations(operations);

    return response.status(200).json({
      ok: true,
      role,
      from: eventId,
      to: targetDate,

      booking: {
        ...movedBooking,
        id: targetDate
      }
    });

  } catch (error) {
    console.error(
      "MOVE_EVENT_FAILED",
      error
    );

    /*
     * Προσωρινά επιστρέφουμε και το μήνυμα,
     * ώστε αν ξαναπέσει να δούμε ΑΚΡΙΒΩΣ γιατί.
     */
    return response.status(500).json({
      ok: false,
      code:
        error?.code ||
        "MOVE_EVENT_FAILED",

      message:
        error?.message ||
        "Unknown move-event error"
    });
  }
}
