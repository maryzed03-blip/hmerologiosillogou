import {
  commitMutations,
  getAccessRole,
  getDocument,
  queryCollection
} from "../firestore-rest.js";

function clean(value, max = 120) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function normalizeName(value) {
  return clean(value, 180)
    .toLocaleLowerCase("el-GR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:()"'’`´\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEventOwner(
  role,
  actorName,
  booking
) {
  // Η Διοίκηση μπορεί να μετακινεί όλες τις δράσεις.
  if (role === "admin") {
    return true;
  }

  if (role !== "member") {
    return false;
  }

  const actor =
    normalizeName(actorName);

  if (!actor) {
    return false;
  }

  /*
   * Νέες δράσεις:
   * χρησιμοποιούμε owner_name.
   */
  const explicitOwner =
    normalizeName(
      booking?.owner_name
    );

  if (explicitOwner) {
    return explicitOwner === actor;
  }

  /*
   * Παλιές δράσεις:
   * fallback στα ονόματα
   * των συντονιστών.
   */
  return [
    booking?.therapist_name,
    booking?.additional_coordinator_name,
    booking?.third_coordinator_name,
    booking?.fourth_coordinator_name
  ].some(
    (name) =>
      normalizeName(name) === actor
  );
}

export default async function handler(
  request,
  response
) {
  if (request.method !== "POST") {
    response.setHeader(
      "Allow",
      "POST"
    );

    return response
      .status(405)
      .json({
        ok: false,
        code: "METHOD_NOT_ALLOWED"
      });
  }

  const code =
    clean(
      request.body?.code,
      20
    );

  const role =
    getAccessRole(code);

  if (!role) {
    return response
      .status(401)
      .json({
        ok: false,
        code: "INVALID_CODE"
      });
  }

  /*
   * Το όνομα του χρήστη
   * που έχει μπει στο portal.
   */
  const actorName =
    clean(
      request.body?.actorName,
      180
    );

  const eventId =
    clean(
      request.body?.eventId,
      20
    );

  const targetDate =
    clean(
      request.body?.targetDate,
      20
    );

  const datePattern =
    /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(eventId) ||
    !datePattern.test(targetDate)
  ) {
    return response
      .status(400)
      .json({
        ok: false,
        code: "INVALID_DATE"
      });
  }

  if (eventId === targetDate) {
    return response
      .status(400)
      .json({
        ok: false,
        code: "SAME_DATE"
      });
  }

  if (
    targetDate < "2026-07-01" ||
    targetDate > "2027-08-31"
  ) {
    return response
      .status(400)
      .json({
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
      return response
        .status(404)
        .json({
          ok: false,
          code: "EVENT_NOT_FOUND"
        });
    }

    /*
     * Επιτρέπεται μετακίνηση μόνο:
     * - στη Διοίκηση
     * - στον δημιουργό της δράσης
     */
    if (
      !isEventOwner(
        role,
        actorName,
        current.data || {}
      )
    ) {
      return response
        .status(403)
        .json({
          ok: false,
          code: "EVENT_OWNER_REQUIRED"
        });
    }

    const target =
      await getDocument(
        "bookings",
        targetDate
      );

    if (target) {
      return response
        .status(409)
        .json({
          ok: false,
          code: "TARGET_DATE_OCCUPIED"
        });
    }

    /*
     * Μεταφέρουμε μαζί
     * και τις συμμετοχές.
     */
    const registrations =
      await queryCollection(
        "eventRegistrations",
        "event_id",
        eventId
      );

    /*
     * Μεταφέρουμε επίσης
     * δηλώσεις πληρωμής,
     * αν υπάρχουν.
     */
    const declarations =
      await queryCollection(
        "paymentDeclarations",
        "event_id",
        eventId
      ).catch(() => []);

    const movedBooking = {
      ...current.data,

      booking_date:
        targetDate,

      updated_at:
        new Date()
    };

    const operations = [
      {
        type: "create",

        collectionId:
          "bookings",

        documentId:
          targetDate,

        data:
          movedBooking
      },

      ...registrations.map(
        (item) => ({
          type: "update",

          collectionId:
            "eventRegistrations",

          documentId:
            item.id,

          data: {
            event_id:
              targetDate,

            event_date:
              targetDate
          }
        })
      ),

      ...declarations.map(
        (item) => ({
          type: "update",

          collectionId:
            "paymentDeclarations",

          documentId:
            item.id,

          data: {
            event_id:
              targetDate,

            event_date:
              targetDate
          }
        })
      ),

      {
        type: "delete",

        collectionId:
          "bookings",

        documentId:
          eventId
      }
    ];

    await commitMutations(
      operations
    );

    return response
      .status(200)
      .json({
        ok: true,
        role,

        from:
          eventId,

        to:
          targetDate,

        registrationCount:
          registrations.length,

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

    return response
      .status(500)
      .json({
        ok: false,

        code:
          error?.code ||
          "MOVE_EVENT_FAILED"
      });
  }
}
