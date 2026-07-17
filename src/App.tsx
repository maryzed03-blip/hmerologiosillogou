import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type FirestoreError,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { db, ensureAnonymousUser } from "./firebase";

type Booking = {
  id: string;
  booking_date: string;
  therapist_name: string;
  action_time: string | null;
  topic: string | null;
  description: string | null;
  owner_uid: string;
};

const MONTHS = [
  { key: "2026-10", label: "Οκτώβριος 2026", year: 2026, month: 9 },
  { key: "2026-11", label: "Νοέμβριος 2026", year: 2026, month: 10 },
  { key: "2026-12", label: "Δεκέμβριος 2026", year: 2026, month: 11 },
  { key: "2027-01", label: "Ιανουάριος 2027", year: 2027, month: 0 },
  { key: "2027-02", label: "Φεβρουάριος 2027", year: 2027, month: 1 },
] as const;

const WEEKDAYS = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
const PLACEHOLDER = "Θα συμπληρωθεί αργότερα";

function toDateString(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function bookingFromSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): Booking {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    booking_date: String(data.booking_date ?? snapshot.id),
    therapist_name: String(data.therapist_name ?? ""),
    action_time:
      typeof data.action_time === "string" ? data.action_time : null,
    topic: typeof data.topic === "string" ? data.topic : null,
    description:
      typeof data.description === "string" ? data.description : null,
    owner_uid: String(data.owner_uid ?? ""),
  };
}

function firebaseMessage(error: unknown, fallback: string) {
  const code = (error as { code?: string } | null)?.code;

  switch (code) {
    case "auth/operation-not-allowed":
      return "Η ανώνυμη σύνδεση δεν έχει ενεργοποιηθεί στο Firebase Authentication.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Το Firebase απέρριψε την ενέργεια. Έλεγξε αν δημοσίευσες τους κανόνες Firestore.";
    case "unavailable":
    case "firestore/unavailable":
      return "Δεν υπάρχει σύνδεση με τη βάση αυτή τη στιγμή. Έλεγξε το internet και δοκίμασε ξανά.";
    default:
      return fallback;
  }
}

export default function App() {
  const [activeMonth, setActiveMonth] = useState(MONTHS[0].key);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const booking of bookings) map.set(booking.booking_date, booking);
    return map;
  }, [bookings]);

  useEffect(() => {
    let cancelled = false;
    let stopRealtime: (() => void) | undefined;

    ensureAnonymousUser()
      .then((user) => {
        if (cancelled) return;
        setCurrentUid(user.uid);

        const bookingsQuery = query(
          collection(db, "bookings"),
          orderBy("booking_date", "asc"),
        );

        stopRealtime = onSnapshot(
          bookingsQuery,
          (snapshot) => {
            if (cancelled) return;
            setBookings(snapshot.docs.map(bookingFromSnapshot));
            setConnectionError(null);
            setLoading(false);
          },
          (error: FirestoreError) => {
            if (cancelled) return;
            setConnectionError(
              firebaseMessage(
                error,
                "Δεν ήταν δυνατή η φόρτωση των κρατήσεων από το Firebase.",
              ),
            );
            setLoading(false);
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setConnectionError(
          firebaseMessage(error, "Δεν ήταν δυνατή η σύνδεση με το Firebase."),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stopRealtime?.();
    };
  }, []);

  const month = MONTHS.find((item) => item.key === activeMonth)!;

  const calendarCells = useMemo(() => {
    const firstDay = new Date(month.year, month.month, 1);
    const daysInMonth = new Date(
      month.year,
      month.month + 1,
      0,
    ).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;
    const cells: Array<number | null> = [];

    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
  }, [month]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Κοινό ημερολόγιο συλλόγου
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Διαθεσιμότητα Θεραπευτών για Δράσεις
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Επιλέξτε μια ελεύθερη ημερομηνία για να δηλώσετε σεμινάριο ή
            βιωματικό εργαστήριο. Οι πράσινες ημερομηνίες έχουν ήδη δεσμευτεί.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {connectionError && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="font-semibold">Δεν συνδέθηκε η εφαρμογή:</strong>{" "}
            {connectionError}
          </div>
        )}

        <nav
          aria-label="Επιλογή μήνα"
          className="mb-6 flex gap-2 overflow-x-auto pb-2"
        >
          {MONTHS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveMonth(item.key)}
              className={
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition " +
                (activeMonth === item.key
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-800")
              }
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold">{month.label}</h2>
            <span className="text-xs text-slate-500">
              {loading ? "Σύνδεση με Firebase…" : `${bookings.length} κρατήσεις`}
            </span>
          </div>

          <div className="overflow-x-auto p-3 sm:p-5">
            <div className="min-w-[630px]">
              <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-500">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="py-1.5">
                    {weekday}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map((day, index) => {
                  if (day === null) {
                    return (
                      <div
                        key={`empty-${index}`}
                        className="h-24 rounded-lg bg-slate-50/70"
                      />
                    );
                  }

                  const date = toDateString(month.year, month.month, day);
                  const booking = bookingsByDate.get(date);
                  const isBooked = Boolean(booking);

                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={loading || Boolean(connectionError)}
                      onClick={() =>
                        booking ? setViewBooking(booking) : setSelectedDate(date)
                      }
                      className={
                        "flex h-24 flex-col items-start rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 " +
                        (isBooked
                          ? "border-emerald-500 bg-emerald-100 hover:bg-emerald-200"
                          : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50")
                      }
                    >
                      <span
                        className={
                          "text-sm font-bold " +
                          (isBooked ? "text-emerald-950" : "text-slate-700")
                        }
                      >
                        {day}
                      </span>

                      {booking && (
                        <>
                          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            Δεσμευμένη
                          </span>
                          <span className="mt-1 line-clamp-2 text-xs font-medium leading-4 text-emerald-950">
                            {booking.therapist_name}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded border border-slate-300 bg-white" />
            Ελεύθερη ημερομηνία
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded border border-emerald-500 bg-emerald-100" />
            Δεσμευμένη ημερομηνία
          </span>
        </div>

        <p className="mt-6 rounded-lg bg-slate-100 px-4 py-3 text-xs leading-5 text-slate-600">
          Η επεξεργασία ή η ακύρωση μιας κράτησης γίνεται μόνο από τον ίδιο
          browser και την ίδια συσκευή από όπου δημιουργήθηκε.
        </p>
      </main>

      {selectedDate && (
        <BookingForm
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
          onSaved={(booking) => {
            setBookings((previous) => [
              ...previous.filter(
                (item) =>
                  item.id !== booking.id &&
                  item.booking_date !== booking.booking_date,
              ),
              booking,
            ]);
            setSelectedDate(null);
          }}
        />
      )}

      {viewBooking && (
        <BookingDetails
          booking={viewBooking}
          canManage={
            Boolean(currentUid) && viewBooking.owner_uid === currentUid
          }
          onClose={() => setViewBooking(null)}
          onEdit={() => {
            const booking = viewBooking;
            setViewBooking(null);
            setEditBooking(booking);
          }}
          onDeleted={(id) => {
            setBookings((previous) =>
              previous.filter((item) => item.id !== id),
            );
            setViewBooking(null);
          }}
        />
      )}

      {editBooking && (
        <BookingForm
          date={editBooking.booking_date}
          existing={editBooking}
          onClose={() => setEditBooking(null)}
          onSaved={(booking) => {
            setBookings((previous) => [
              ...previous.filter((item) => item.id !== booking.id),
              booking,
            ]);
            setEditBooking(null);
          }}
        />
      )}
    </div>
  );
}

function formatDateGreek(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function BookingForm({
  date,
  existing,
  onClose,
  onSaved,
}: {
  date: string;
  existing?: Booking;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [name, setName] = useState(existing?.therapist_name ?? "");
  const [time, setTime] = useState(existing?.action_time ?? "");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [description, setDescription] = useState(
    existing?.description ?? "",
  );
  const [laterTime, setLaterTime] = useState(
    existing ? existing.action_time === null : false,
  );
  const [laterTopic, setLaterTopic] = useState(
    existing ? existing.topic === null : false,
  );
  const [laterDescription, setLaterDescription] = useState(
    existing ? existing.description === null : false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (name.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του θεραπευτή.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const user = await ensureAnonymousUser();
      const bookingRef = doc(db, "bookings", date);
      const values = {
        booking_date: date,
        therapist_name: name.trim(),
        action_time: laterTime ? null : time.trim() || null,
        topic: laterTopic ? null : topic.trim() || null,
        description: laterDescription ? null : description.trim() || null,
      };

      if (existing) {
        if (existing.owner_uid !== user.uid) {
          throw Object.assign(new Error("NOT_OWNER"), {
            code: "not-owner",
          });
        }

        await updateDoc(bookingRef, {
          ...values,
          owner_uid: existing.owner_uid,
          updated_at: serverTimestamp(),
        });

        onSaved({
          ...existing,
          ...values,
        });
      } else {
        await runTransaction(db, async (transaction) => {
          const current = await transaction.get(bookingRef);
          if (current.exists()) {
            throw Object.assign(new Error("DATE_ALREADY_BOOKED"), {
              code: "date-already-booked",
            });
          }

          transaction.set(bookingRef, {
            ...values,
            owner_uid: user.uid,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        });

        onSaved({
          id: date,
          ...values,
          owner_uid: user.uid,
        });
      }
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;

      if (code === "date-already-booked") {
        setError(
          "Η ημερομηνία δεσμεύτηκε μόλις από άλλο μέλος. Επιλέξτε άλλη ημερομηνία.",
        );
      } else if (code === "not-owner") {
        setError("Δεν μπορείτε να επεξεργαστείτε αυτή την κράτηση.");
      } else {
        setError(
          firebaseMessage(
            caughtError,
            "Παρουσιάστηκε σφάλμα κατά την αποθήκευση. Δοκιμάστε ξανά.",
          ),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={saving ? undefined : onClose}>
      <h3 className="text-lg font-semibold">
        {existing ? "Επεξεργασία δέσμευσης" : "Νέα δέσμευση"}
      </h3>
      <p className="mb-5 mt-1 text-sm capitalize text-slate-600">
        {formatDateGreek(date)}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="name">
            Ονοματεπώνυμο θεραπευτή <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <OptionalField
          id="time"
          label="Ώρα δράσης"
          value={time}
          onChange={setTime}
          later={laterTime}
          onLaterChange={setLaterTime}
          placeholder="π.χ. 18:00 – 20:00"
        />

        <OptionalField
          id="topic"
          label="Θέμα σεμιναρίου ή βιωματικού εργαστηρίου"
          value={topic}
          onChange={setTopic}
          later={laterTopic}
          onLaterChange={setLaterTopic}
          placeholder="Γράψτε έναν σύντομο τίτλο"
        />

        <OptionalField
          id="description"
          label="Σύντομη περιγραφή"
          value={description}
          onChange={setDescription}
          later={laterDescription}
          onLaterChange={setLaterDescription}
          placeholder="Λίγες πληροφορίες για το περιεχόμενο της δράσης"
          textarea
        />

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OptionalField({
  id,
  label,
  value,
  onChange,
  later,
  onLaterChange,
  placeholder,
  textarea = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  later: boolean;
  onLaterChange: (value: boolean) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  const fieldClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400";

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor={id}>
        {label}
      </label>

      {textarea ? (
        <textarea
          id={id}
          value={later ? "" : value}
          onChange={(event) => onChange(event.target.value)}
          disabled={later}
          rows={4}
          placeholder={placeholder}
          className={fieldClass}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={later ? "" : value}
          onChange={(event) => onChange(event.target.value)}
          disabled={later}
          placeholder={placeholder}
          className={fieldClass}
        />
      )}

      <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600">
        <input
          type="checkbox"
          checked={later}
          onChange={(event) => onLaterChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-emerald-600"
        />
        Θα επιστρέψω να το συμπληρώσω
      </label>
    </div>
  );
}

function BookingDetails({
  booking,
  canManage,
  onClose,
  onEdit,
  onDeleted,
}: {
  booking: Booking;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("Θέλετε σίγουρα να ακυρώσετε αυτή τη δέσμευση;")) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const user = await ensureAnonymousUser();
      if (booking.owner_uid !== user.uid) {
        throw Object.assign(new Error("NOT_OWNER"), { code: "not-owner" });
      }

      await deleteDoc(doc(db, "bookings", booking.booking_date));
      onDeleted(booking.id);
    } catch (caughtError) {
      setError(
        firebaseMessage(
          caughtError,
          "Δεν ήταν δυνατή η ακύρωση της κράτησης.",
        ),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={deleting ? undefined : onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Δεσμευμένη ημερομηνία
          </p>
          <h3 className="mt-1 text-lg font-semibold capitalize">
            {formatDateGreek(booking.booking_date)}
          </h3>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
          Κρατημένη
        </span>
      </div>

      <dl className="mt-6 space-y-4 text-sm">
        <DetailRow label="Θεραπευτής" value={booking.therapist_name} />
        <DetailRow label="Ώρα" value={booking.action_time} />
        <DetailRow label="Θέμα" value={booking.topic} />
        <DetailRow label="Περιγραφή" value={booking.description} />
      </dl>

      {!canManage && (
        <p className="mt-5 rounded-lg bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-600">
          Μόνο το μέλος που δημιούργησε αυτή την κράτηση από τη συγκεκριμένη
          συσκευή μπορεί να την επεξεργαστεί ή να την ακυρώσει.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {canManage && (
          <>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {deleting ? "Ακύρωση…" : "Ακύρωση δέσμευσης"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={deleting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              Επεξεργασία
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Κλείσιμο
        </button>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  const isEmpty = !value || !value.trim();

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className={
          "mt-1 leading-6 " +
          (isEmpty ? "italic text-slate-400" : "text-slate-900")
        }
      >
        {isEmpty ? PLACEHOLDER : value}
      </dd>
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"
      onClick={() => onClose?.()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="my-auto w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
