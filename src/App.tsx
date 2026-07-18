import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type FirestoreError,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { db, ensureAnonymousUser } from "./firebase";

type BookingStatus = "booked" | "completed";

type Booking = {
  id: string;
  booking_date: string;
  therapist_name: string;
  action_time: string | null;
  topic: string | null;
  description: string | null;
  owner_uid: string;
  status: BookingStatus;
  is_public: boolean;
};

type MonthItem = {
  key: string;
  label: string;
  year: number;
  month: number;
};

const PLACEHOLDER = "Θα συμπληρωθεί αργότερα";
const WEEKDAYS = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];

const STATIC_BOOKINGS: Booking[] = [
  {
    id: "2026-07-05",
    booking_date: "2026-07-05",
    therapist_name: "Ευαγγελία Ξανθοπούλου, Μαρία Ζάχου",
    action_time: "19:30 – 21:30",
    topic: "Από την εσωτερική ησυχία στην αυθεντική συνάντηση",
    description: "Πραγματοποιημένη δράση συλλόγου. Η ημερομηνία παραμένει ως ιστορική αναφορά.",
    owner_uid: "static-completed-event",
    status: "completed",
    is_public: true,
  },
];

function buildMonths(startYear: number, startMonth: number, endYear: number, endMonth: number): MonthItem[] {
  const result: MonthItem[] = [];
  const current = new Date(startYear, startMonth, 1);
  const end = new Date(endYear, endMonth, 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    result.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: current.toLocaleDateString("el-GR", {
        month: "long",
        year: "numeric",
      }).replace(/^./, (m) => m.toUpperCase()),
      year,
      month,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return result;
}

const MONTHS = buildMonths(2026, 6, 2027, 7); // Ιούλιος 2026 έως Αύγουστος 2027

function getInitialMonthKey() {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const firstKey = MONTHS[0].key;
  const lastKey = MONTHS[MONTHS.length - 1].key;

  if (MONTHS.some((item) => item.key === currentKey)) return currentKey;
  if (currentKey < firstKey) return firstKey;
  if (currentKey > lastKey) return lastKey;
  return firstKey;
}

function toDateString(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function bookingFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Booking {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    booking_date: String(data.booking_date ?? snapshot.id),
    therapist_name: String(data.therapist_name ?? ""),
    action_time: typeof data.action_time === "string" ? data.action_time : null,
    topic: typeof data.topic === "string" ? data.topic : null,
    description: typeof data.description === "string" ? data.description : null,
    owner_uid: String(data.owner_uid ?? ""),
    status: data.status === "completed" ? "completed" : "booked",
    is_public: data.is_public === true,
  };
}

function firebaseMessage(error: unknown, fallback: string) {
  const code = (error as { code?: string } | null)?.code;

  switch (code) {
    case "auth/operation-not-allowed":
      return "Η ανώνυμη σύνδεση δεν έχει ενεργοποιηθεί στο Firebase Authentication.";
    case "auth/unauthorized-domain":
      return "Το domain του Vercel δεν έχει προστεθεί στα Authorized domains του Firebase Authentication.";
    case "auth/configuration-not-found":
      return "Δεν έχει ολοκληρωθεί η ρύθμιση του Firebase Authentication για αυτή την εφαρμογή.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Το Firebase απέρριψε την ενέργεια. Άνοιξε το αρχείο firestore.rules και δημοσίευσέ το στο Firestore → Rules.";
    case "failed-precondition":
    case "firestore/failed-precondition":
      return "Δεν έχει δημιουργηθεί σωστά η βάση Firestore ή λείπει κάποια απαραίτητη ρύθμιση.";
    case "unavailable":
    case "firestore/unavailable":
      return "Δεν υπάρχει σύνδεση με τη βάση αυτή τη στιγμή. Έλεγξε το internet και δοκίμασε ξανά.";
    default:
      return fallback;
  }
}

function mergeBookings(liveBookings: Booking[]) {
  const map = new Map<string, Booking>();
  for (const item of STATIC_BOOKINGS) map.set(item.booking_date, item);
  for (const item of liveBookings) map.set(item.booking_date, item);
  return Array.from(map.values()).sort((a, b) => a.booking_date.localeCompare(b.booking_date));
}


type NotificationAction = "create" | "update" | "delete";

async function notifyAdmin(action: NotificationAction, booking: Booking) {
  try {
    const response = await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        booking_date: booking.booking_date,
        therapist_name: booking.therapist_name,
        action_time: booking.action_time,
        topic: booking.topic,
        description: booking.description,
        is_public: booking.is_public,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn("Η ειδοποίηση email απέτυχε.", payload);
      return { ok: false, code: typeof payload.code === "string" ? payload.code : `HTTP_${response.status}` };
    }
    return { ok: true, code: "EMAIL_SENT" };
  } catch (error) {
    console.warn("Η ειδοποίηση email απέτυχε.", error);
    return { ok: false, code: "NETWORK_ERROR" };
  }
}


const MANAGE_ACCESS_KEY = "association-manage-unlocked";
const MANAGE_CODE = "1111";


function AssociationLogo({ size = "md", centered = false }: { size?: "sm" | "md"; centered?: boolean }) {
  const sizeClass = size === "sm" ? "h-24 w-24 sm:h-28 sm:w-28" : "h-28 w-28 sm:h-32 sm:w-32";
  return (
    <div className={centered ? "flex justify-center" : ""}>
      <div className={`overflow-hidden rounded-full border border-slate-200 bg-white p-1 shadow-sm ${sizeClass}`}>
        <img src="/logo.png" alt="Λογότυπο Σ.Ε.Ψ.Υ.G" className="h-full w-full rounded-full object-cover" />
      </div>
    </div>
  );
}

function ManageAccess() {
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(MANAGE_ACCESS_KEY) === "yes";
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleUnlock(event: FormEvent) {
    event.preventDefault();
    if (code.trim() !== MANAGE_CODE) {
      setError("Ο κωδικός δεν είναι σωστός.");
      setCode("");
      return;
    }

    window.sessionStorage.setItem(MANAGE_ACCESS_KEY, "yes");
    setUnlocked(true);
    setError(null);
  }

  if (unlocked) {
    return (
      <>
        <ManageApp />
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(MANAGE_ACCESS_KEY);
            setUnlocked(false);
          }}
          className="fixed bottom-4 right-4 z-40 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-lg hover:bg-slate-50"
        >
          Έξοδος από τη διαχείριση
        </button>
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <AssociationLogo centered />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Περιοχή μελών</p>
        <h1 className="mt-2 text-2xl font-semibold">Διαχείριση ημερολογίου</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Πληκτρολογήστε τον κωδικό για να ανοίξετε το ημερολόγιο διαθεσιμότητας.
        </p>

        <form onSubmit={handleUnlock} className="mt-6 space-y-4">
          <div>
            <label htmlFor="manage-code" className="mb-1.5 block text-sm font-medium">Κωδικός</label>
            <input
              id="manage-code"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-xl tracking-[0.4em] focus:border-emerald-500 focus:outline-none"
              placeholder="••••"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
            Είσοδος
          </button>
        </form>

        <a href="/events" className="mt-5 block text-center text-xs font-medium text-slate-500 hover:text-emerald-700">
          Επιστροφή στο δημόσιο πρόγραμμα
        </a>
      </div>
    </div>
  );
}

function ManageApp() {
  const [activeMonth, setActiveMonth] = useState(getInitialMonthKey);
  const [bookings, setBookings] = useState<Booking[]>(STATIC_BOOKINGS);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [emailNotice, setEmailNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function reportEmailStatus(result: { ok: boolean; code: string }) {
    setEmailNotice(result.ok
      ? { ok: true, text: "Η αλλαγή αποθηκεύτηκε και η ειδοποίηση email στάλθηκε." }
      : { ok: false, text: `Η αλλαγή αποθηκεύτηκε, αλλά το email δεν στάλθηκε (${result.code}).` });
    window.setTimeout(() => setEmailNotice(null), 9000);
  }

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

        stopRealtime = onSnapshot(
          collection(db, "bookings"),
          (snapshot) => {
            if (cancelled) return;
            const liveBookings = snapshot.docs.map(bookingFromSnapshot);
            setBookings(mergeBookings(liveBookings));
            setConnectionError(null);
            setLoading(false);
          },
          (error: FirestoreError) => {
            if (cancelled) return;
            setBookings(STATIC_BOOKINGS);
            setConnectionError(firebaseMessage(error, "Δεν ήταν δυνατή η φόρτωση των κρατήσεων από το Firebase."));
            setLoading(false);
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setBookings(STATIC_BOOKINGS);
        setConnectionError(firebaseMessage(error, "Δεν ήταν δυνατή η σύνδεση με το Firebase."));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stopRealtime?.();
    };
  }, []);

  const month = MONTHS.find((item) => item.key === activeMonth) ?? MONTHS[0];

  const calendarCells = useMemo(() => {
    const firstDay = new Date(month.year, month.month, 1);
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
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
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
          <AssociationLogo size="sm" />
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Κοινό ημερολόγιο συλλόγου
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Διαθεσιμότητα Θεραπευτών για Δράσεις
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Επιλέξτε μια ελεύθερη ημερομηνία για να δηλώσετε σεμινάριο ή βιωματικό εργαστήριο.
            Οι πράσινες ημερομηνίες έχουν ήδη δεσμευτεί και οι λιλά έχουν ήδη πραγματοποιηθεί.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/events"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-800"
            >
              Προβολή δημόσιου προγράμματος
            </a>
            <a
              href="https://eusyllogossepshyg.carrd.co/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Ιστοσελίδα Συλλόγου
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {emailNotice && (
          <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${emailNotice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {emailNotice.text}
          </div>
        )}

        {connectionError && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="font-semibold">Πρόβλημα σύνδεσης με Firebase:</strong> {connectionError}
          </div>
        )}

        <div className="mb-6">
          <label htmlFor="manage-month" className="mb-2 block text-sm font-semibold text-slate-700 sm:hidden">
            Επιλογή μήνα
          </label>
          <select
            id="manage-month"
            value={activeMonth}
            onChange={(event) => setActiveMonth(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none sm:hidden"
          >
            {MONTHS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <nav aria-label="Επιλογή μήνα" className="hidden gap-2 overflow-x-auto pb-2 sm:flex">
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
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold">{month.label}</h2>
            <span className="text-xs text-slate-500">{loading ? "Σύνδεση με Firebase…" : `${bookings.length} συνολικά γεγονότα`}</span>
          </div>

          <div className="p-2 sm:p-5">
            <div className="w-full">
              <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-500 sm:mb-2 sm:gap-1.5 sm:text-xs">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="py-1.5">{weekday}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map((day, index) => {
                  if (day === null) {
                    return <div key={`empty-${index}`} className="h-14 rounded-md bg-slate-50/70 sm:h-28 sm:rounded-lg" />;
                  }

                  const date = toDateString(month.year, month.month, day);
                  const booking = bookingsByDate.get(date);
                  const status = booking?.status ?? null;

                  const buttonClass =
                    status === "completed"
                      ? "border-violet-400 bg-violet-100 hover:bg-violet-200"
                      : status === "booked"
                        ? "border-emerald-500 bg-emerald-100 hover:bg-emerald-200"
                        : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50";

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => booking ? setViewBooking(booking) : setSelectedDate(date)}
                      className={`flex h-14 min-w-0 flex-col items-center justify-start rounded-md border p-1.5 text-center transition sm:h-28 sm:items-start sm:rounded-lg sm:p-2.5 sm:text-left ${buttonClass}`}
                    >
                      <span className={`text-xs font-bold sm:text-sm ${status === "completed" ? "text-violet-950" : status === "booked" ? "text-emerald-950" : "text-slate-700"}`}>
                        {day}
                      </span>

                      {booking && (
                        <>
                          <span className={`mt-1 h-2 w-2 rounded-full sm:hidden ${status === "completed" ? "bg-violet-600" : "bg-emerald-600"}`} aria-hidden="true" />
                          <span className={`mt-1 hidden text-[10px] font-semibold uppercase tracking-wide sm:block ${status === "completed" ? "text-violet-700" : "text-emerald-700"}`}>
                            {status === "completed" ? "Πραγματοποιήθηκε" : "Δεσμευμένη"}
                          </span>
                          <span className={`mt-1 hidden line-clamp-2 text-xs font-medium leading-4 sm:block ${status === "completed" ? "text-violet-950" : "text-emerald-950"}`}>
                            {booking.therapist_name}
                          </span>
                          {booking.topic && (
                            <span className={`mt-1 hidden line-clamp-2 text-[11px] leading-4 sm:block ${status === "completed" ? "text-violet-800" : "text-slate-700"}`}>
                              {booking.topic}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
        <p className="mt-2 text-xs leading-5 text-slate-500 sm:hidden">Πατήστε μια ημερομηνία για να δείτε ή να συμπληρώσετε τα στοιχεία της.</p>

        <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded border border-slate-300 bg-white" />
            Ελεύθερη ημερομηνία
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded border border-emerald-500 bg-emerald-100" />
            Δεσμευμένη ημερομηνία
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded border border-violet-400 bg-violet-100" />
            Πραγματοποιημένη δράση
          </span>
        </div>

        <p className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
          Όλα τα μέλη που εισέρχονται με τον κωδικό διαχείρισης μπορούν να επεξεργάζονται ή να ακυρώνουν οποιαδήποτε κράτηση.
        </p>
      </main>

      {selectedDate && (
        <BookingForm
          date={selectedDate}
          connectionError={connectionError}
          onEmailStatus={reportEmailStatus}
          onClose={() => setSelectedDate(null)}
          onSaved={(booking) => {
            setBookings((previous) => mergeBookings([...previous.filter((item) => item.id !== booking.id && item.booking_date !== booking.booking_date), booking]));
            setSelectedDate(null);
          }}
        />
      )}

      {viewBooking && (
        <BookingDetails
          booking={viewBooking}
          canManage={viewBooking.status === "booked"}
          onClose={() => setViewBooking(null)}
          onEdit={() => {
            if (viewBooking.status === "completed") return;
            const booking = viewBooking;
            setViewBooking(null);
            setEditBooking(booking);
          }}
          onEmailStatus={reportEmailStatus}
          onDeleted={(id) => {
            setBookings((previous) => previous.filter((item) => item.id !== id));
            setViewBooking(null);
          }}
        />
      )}

      {editBooking && (
        <BookingForm
          date={editBooking.booking_date}
          existing={editBooking}
          connectionError={connectionError}
          onEmailStatus={reportEmailStatus}
          onClose={() => setEditBooking(null)}
          onSaved={(booking) => {
            setBookings((previous) => mergeBookings([...previous.filter((item) => item.id !== booking.id), booking]));
            setEditBooking(null);
          }}
        />
      )}
    </div>
  );
}


function PublicEventsApp() {
  const [activeMonth, setActiveMonth] = useState(getInitialMonthKey);
  const [bookings, setBookings] = useState<Booking[]>(STATIC_BOOKINGS);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopRealtime: (() => void) | undefined;

    ensureAnonymousUser()
      .then(() => {
        if (cancelled) return;
        stopRealtime = onSnapshot(
          collection(db, "bookings"),
          (snapshot) => {
            if (cancelled) return;
            setBookings(mergeBookings(snapshot.docs.map(bookingFromSnapshot)));
            setConnectionError(null);
            setLoading(false);
          },
          (error: FirestoreError) => {
            if (cancelled) return;
            setBookings(STATIC_BOOKINGS);
            setConnectionError(firebaseMessage(error, "Δεν ήταν δυνατή η φόρτωση του δημόσιου προγράμματος."));
            setLoading(false);
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setBookings(STATIC_BOOKINGS);
        setConnectionError(firebaseMessage(error, "Δεν ήταν δυνατή η σύνδεση με το δημόσιο πρόγραμμα."));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stopRealtime?.();
    };
  }, []);

  const publicBookings = useMemo(
    () => bookings.filter((booking) => booking.is_public).sort((a, b) => a.booking_date.localeCompare(b.booking_date)),
    [bookings],
  );

  const publicBookingsByDate = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const booking of publicBookings) map.set(booking.booking_date, booking);
    return map;
  }, [publicBookings]);

  const month = MONTHS.find((item) => item.key === activeMonth) ?? MONTHS[0];
  const calendarCells = useMemo(() => {
    const firstDay = new Date(month.year, month.month, 1);
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;
    const cells: Array<number | null> = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const monthEvents = publicBookings.filter((booking) => booking.booking_date.startsWith(month.key));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
          <AssociationLogo size="sm" />
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Δημόσιο πρόγραμμα δράσεων</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Σεμινάρια & Βιωματικά Εργαστήρια</h1>
          <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-700">Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.Ψ.Υ.G Σωματικά Επικεντρωμένης Ψυχοθεραπείας Gestalt</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Δείτε τις προγραμματισμένες και τις πραγματοποιημένες δράσεις του συλλόγου.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="https://eusyllogossepshyg.carrd.co/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Επισκεφθείτε την ιστοσελίδα του Συλλόγου
            </a>
            <a
              href="/manage"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-800"
            >
              Manage
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {connectionError && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="font-semibold">Πρόβλημα σύνδεσης:</strong> {connectionError}
          </div>
        )}

        <div className="mb-6">
          <label htmlFor="events-month" className="mb-2 block text-sm font-semibold text-slate-700 sm:hidden">
            Επιλογή μήνα
          </label>
          <select
            id="events-month"
            value={activeMonth}
            onChange={(event) => setActiveMonth(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm focus:border-sky-500 focus:outline-none sm:hidden"
          >
            {MONTHS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <nav aria-label="Επιλογή μήνα" className="hidden gap-2 overflow-x-auto pb-2 sm:flex">
            {MONTHS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveMonth(item.key)}
                className={
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition " +
                  (activeMonth === item.key
                    ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                    : "border-slate-300 bg-white text-slate-700 hover:border-sky-400 hover:text-sky-800")
                }
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold">{month.label}</h2>
            <span className="text-xs text-slate-500">{loading ? "Φόρτωση…" : `${monthEvents.length} δράσεις`}</span>
          </div>

          <div className="p-2 sm:p-5">
            <div className="w-full">
              <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-500 sm:mb-2 sm:gap-1.5 sm:text-xs">
                {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1.5">{weekday}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map((day, index) => {
                  if (day === null) return <div key={`empty-${index}`} className="h-14 rounded-md bg-slate-50/70 sm:h-28 sm:rounded-lg" />;
                  const date = toDateString(month.year, month.month, day);
                  const booking = publicBookingsByDate.get(date);
                  const isCompleted = booking?.status === "completed";
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!booking}
                      onClick={() => booking && setViewBooking(booking)}
                      className={
                        "flex h-14 min-w-0 flex-col items-center justify-start rounded-md border p-1.5 text-center transition sm:h-28 sm:items-start sm:rounded-lg sm:p-2.5 sm:text-left " +
                        (booking
                          ? isCompleted
                            ? "border-violet-400 bg-violet-100 hover:bg-violet-200"
                            : "border-sky-500 bg-sky-100 hover:bg-sky-200"
                          : "cursor-default border-slate-100 bg-slate-50 text-slate-400")
                      }
                    >
                      <span className={`text-xs font-bold sm:text-sm ${booking ? (isCompleted ? "text-violet-950" : "text-sky-950") : "text-slate-400"}`}>{day}</span>
                      {booking && (
                        <>
                          <span className={`mt-1 h-2 w-2 rounded-full sm:hidden ${isCompleted ? "bg-violet-600" : "bg-sky-600"}`} aria-hidden="true" />
                          <span className={`mt-1 hidden text-[10px] font-semibold uppercase tracking-wide sm:block ${isCompleted ? "text-violet-700" : "text-sky-700"}`}>
                            {isCompleted ? "Πραγματοποιήθηκε" : "Προσεχώς"}
                          </span>
                          <span className={`mt-1 hidden line-clamp-3 text-xs font-semibold leading-4 sm:block ${isCompleted ? "text-violet-950" : "text-sky-950"}`}>
                            {booking.topic || "Δράση συλλόγου"}
                          </span>
                          {booking.action_time && <span className="mt-1 hidden text-[11px] text-slate-700 sm:block">{booking.action_time}</span>}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
        <p className="mt-2 text-xs leading-5 text-slate-500 sm:hidden">Πατήστε μια χρωματισμένη ημερομηνία για να δείτε τη δράση. Οι λεπτομέρειες εμφανίζονται και στη λίστα παρακάτω.</p>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Αναλυτικά</p>
              <h2 className="mt-1 text-xl font-semibold">Δράσεις του μήνα</h2>
            </div>
          </div>

          {monthEvents.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
              Δεν υπάρχουν δημοσιευμένες δράσεις για αυτόν τον μήνα.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {monthEvents.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => setViewBooking(booking)}
                  className={`rounded-xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${booking.status === "completed" ? "border-violet-200" : "border-sky-200"}`}
                >
                  <p className={`text-xs font-semibold uppercase tracking-wide ${booking.status === "completed" ? "text-violet-700" : "text-sky-700"}`}>
                    {booking.status === "completed" ? "Πραγματοποιήθηκε" : "Προσεχώς"}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold leading-6">{booking.topic || "Δράση συλλόγου"}</h3>
                  <p className="mt-2 text-sm font-medium capitalize text-slate-700">{formatDateGreek(booking.booking_date)}</p>
                  <p className="mt-1 text-sm text-slate-600">{booking.action_time || "Η ώρα θα ανακοινωθεί"}</p>
                  {booking.description && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{booking.description}</p>}
                </button>
              ))}
            </div>
          )}
        </section>

        <FriendOfAssociationSection />
      </main>

      {viewBooking && <PublicBookingDetails booking={viewBooking} onClose={() => setViewBooking(null)} />}
    </div>
  );
}


type FriendFormValues = {
  fullName: string;
  email: string;
  phone: string;
  profession: string;
};

function FriendOfAssociationSection() {
  const [values, setValues] = useState<FriendFormValues>({
    fullName: "",
    email: "",
    phone: "",
    profession: "",
  });
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function updateValue(field: keyof FriendFormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (values.fullName.trim().length < 2) {
      setNotice({ ok: false, text: "Συμπληρώστε το ονοματεπώνυμό σας." });
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) {
      setNotice({ ok: false, text: "Συμπληρώστε μια έγκυρη διεύθυνση email." });
      return;
    }

    if (values.phone.trim().length < 6 || values.profession.trim().length < 2) {
      setNotice({ ok: false, text: "Συμπληρώστε τον αριθμό τηλεφώνου και το επάγγελμά σας." });
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/send-friend-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw Object.assign(new Error("REQUEST_FAILED"), {
          code: typeof payload.code === "string" ? payload.code : `HTTP_${response.status}`,
        });
      }

      setValues({ fullName: "", email: "", phone: "", profession: "" });
      setWebsite("");
      setNotice({
        ok: true,
        text: "Το ενδιαφέρον σας στάλθηκε στον Σύλλογο. Θα επικοινωνήσουμε μαζί σας για την ολοκλήρωση της εγγραφής.",
      });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      setNotice({
        ok: false,
        text: `Δεν ήταν δυνατή η αποστολή της φόρμας${code ? ` (${code})` : ""}. Δοκιμάστε ξανά.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = "w-full rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm focus:border-emerald-500 focus:outline-none";

  return (
    <section className="mt-10 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
      <div className="bg-emerald-50 px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Στήριξε τις δράσεις μας</p>
        <h2 className="mt-2 text-2xl font-bold text-emerald-950 underline decoration-emerald-400 decoration-2 underline-offset-4">Γίνε Φίλος του Συλλόγου μας!</h2>

        <div className="mt-4 max-w-4xl space-y-3 text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
          <p>Οι περισσότερες δράσεις και τα σεμινάρια που διοργανώνουμε προσφέρονται <strong className="font-bold text-emerald-950">δωρεάν</strong>, με στόχο να είναι <u className="decoration-emerald-500 decoration-2 underline-offset-2">ανοιχτά και προσβάσιμα</u> σε όσο το δυνατόν περισσότερους ανθρώπους.</p>
          <p>Για να μπορούμε όμως να συνεχίζουμε, να οργανώνουμε νέες δράσεις και να δίνουμε μεγαλύτερη εξωστρέφεια στο έργο του Συλλόγου, <strong className="font-bold text-emerald-950">χρειαζόμαστε τη στήριξη ανθρώπων που πιστεύουν σε αυτή την προσπάθεια.</strong></p>
          <p>Με μόλις <strong className="font-bold text-emerald-950 underline decoration-emerald-500 decoration-2 underline-offset-2">10 ευρώ τον χρόνο</strong>, μπορείς να γίνεις <strong className="font-bold text-emerald-950">Φίλος του Συλλόγου</strong> και να συμβάλεις ουσιαστικά στη συνέχιση και την ανάπτυξη των δράσεών μας.</p>
          <p>Το ποσό είναι μικρό, αλλά η συμμετοχή και η στήριξη κάθε ανθρώπου έχουν <strong className="font-bold text-emerald-950">πραγματική αξία για εμάς.</strong></p>
          <p className="font-bold text-emerald-950 underline decoration-emerald-500 decoration-2 underline-offset-3">Γίνε κι εσύ μέρος αυτής της προσπάθειας. Γίνε Φίλος του Συλλόγου!</p>
        </div>
      </div>

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <h3 className="text-lg font-semibold">Εκδήλωση ενδιαφέροντος</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Συμπλήρωσε τα στοιχεία σου και ο Σύλλογος θα επικοινωνήσει μαζί σου για το επόμενο βήμα.</p>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="friend-full-name" className="mb-1.5 block text-sm font-medium">Ονοματεπώνυμο</label>
            <input id="friend-full-name" value={values.fullName} onChange={(event) => updateValue("fullName", event.target.value)} required maxLength={160} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="friend-email" className="mb-1.5 block text-sm font-medium">Email</label>
            <input id="friend-email" type="email" value={values.email} onChange={(event) => updateValue("email", event.target.value)} required maxLength={220} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="friend-phone" className="mb-1.5 block text-sm font-medium">Αριθμός τηλεφώνου</label>
            <input id="friend-phone" type="tel" value={values.phone} onChange={(event) => updateValue("phone", event.target.value)} required maxLength={60} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="friend-profession" className="mb-1.5 block text-sm font-medium">Επάγγελμα</label>
            <input id="friend-profession" value={values.profession} onChange={(event) => updateValue("profession", event.target.value)} required maxLength={160} className={fieldClass} />
          </div>

          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="friend-website">Website</label>
            <input id="friend-website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
          </div>

          {notice && (
            <p className={`rounded-lg px-3 py-2.5 text-sm sm:col-span-2 ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              {notice.text}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-5 text-slate-500">Τα στοιχεία χρησιμοποιούνται μόνο για να επικοινωνήσει μαζί σας ο Σύλλογος σχετικά με την εγγραφή σας ως Φίλος.</p>
            <button type="submit" disabled={submitting} className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">
              {submitting ? "Αποστολή…" : "Θέλω να γίνω Φίλος"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PublicBookingDetails({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const isCompleted = booking.status === "completed";
  return (
    <Modal onClose={onClose}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${isCompleted ? "text-violet-700" : "text-sky-700"}`}>
        {isCompleted ? "Πραγματοποιημένη δράση" : "Προσεχής δράση"}
      </p>
      <h3 className="mt-2 text-xl font-semibold leading-7">{booking.topic || "Δράση συλλόγου"}</h3>
      <p className="mt-2 text-sm capitalize text-slate-600">{formatDateGreek(booking.booking_date)}</p>

      <dl className="mt-6 space-y-4 text-sm">
        <DetailRow label="Ώρα" value={booking.action_time} />
        <DetailRow label="Συντονιστές" value={booking.therapist_name} />
        <DetailRow label="Περιγραφή" value={booking.description} />
      </dl>

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
          Κλείσιμο
        </button>
      </div>
    </Modal>
  );
}

export default function App() {
  const path = typeof window === "undefined" ? "/manage" : window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/events" ? <PublicEventsApp /> : <ManageAccess />;
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
  connectionError,
  onEmailStatus,
  onClose,
  onSaved,
}: {
  date: string;
  existing?: Booking;
  connectionError?: string | null;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [name, setName] = useState(existing?.therapist_name ?? "");
  const [time, setTime] = useState(existing?.action_time ?? "");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [laterTime, setLaterTime] = useState(existing ? existing.action_time === null : false);
  const [laterTopic, setLaterTopic] = useState(existing ? existing.topic === null : false);
  const [laterDescription, setLaterDescription] = useState(existing ? existing.description === null : false);
  const [isPublic, setIsPublic] = useState(existing?.is_public ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (name.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του θεραπευτή.");
      return;
    }

    if (isPublic && (laterTime || !time.trim() || laterTopic || !topic.trim())) {
      setError("Για να εμφανιστεί η δράση στο δημόσιο πρόγραμμα, συμπληρώστε τουλάχιστον την ώρα και το θέμα.");
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
        status: "booked" as BookingStatus,
        is_public: isPublic,
      };

      if (existing) {
        await updateDoc(bookingRef, {
          ...values,
          owner_uid: existing.owner_uid,
          updated_at: serverTimestamp(),
        });

        const savedBooking = { ...existing, ...values };
        onSaved(savedBooking);
        void notifyAdmin("update", savedBooking).then(onEmailStatus);
      } else {
        await runTransaction(db, async (transaction) => {
          const current = await transaction.get(bookingRef);
          if (current.exists()) {
            throw Object.assign(new Error("DATE_ALREADY_BOOKED"), { code: "date-already-booked" });
          }

          transaction.set(bookingRef, {
            ...values,
            owner_uid: user.uid,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        });

        const savedBooking = {
          id: date,
          ...values,
          owner_uid: user.uid,
        };
        onSaved(savedBooking);
        void notifyAdmin("create", savedBooking).then(onEmailStatus);
      }
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;

      if (code === "date-already-booked") {
        setError("Η ημερομηνία δεσμεύτηκε μόλις από άλλο μέλος. Επιλέξτε άλλη ημερομηνία.");
      } else {
        setError(firebaseMessage(caughtError, "Παρουσιάστηκε σφάλμα κατά την αποθήκευση. Δοκιμάστε ξανά."));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={saving ? undefined : onClose}>
      <h3 className="text-lg font-semibold">{existing ? "Επεξεργασία δέσμευσης" : "Νέα δέσμευση"}</h3>
      <p className="mb-5 mt-1 text-sm capitalize text-slate-600">{formatDateGreek(date)}</p>

      {connectionError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
          Η φόρμα ανοίγει κανονικά, αλλά η αποθήκευση θα δουλέψει μόνο όταν διορθωθεί η σύνδεση με το Firebase. {connectionError}
        </div>
      )}

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
          placeholder="π.χ. 19:30 – 21:30"
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

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm leading-5 text-sky-950">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-sky-600"
          />
          <span>
            <strong className="block font-semibold">Να εμφανίζεται στο δημόσιο πρόγραμμα</strong>
            <span className="mt-0.5 block text-xs text-sky-800">Η δράση θα εμφανίζεται στον σύνδεσμο /events. Για δημοσίευση χρειάζονται ώρα και θέμα.</span>
          </span>
        </label>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
  onEmailStatus,
  onDeleted,
}: {
  booking: Booking;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("Θέλετε σίγουρα να ακυρώσετε αυτή τη δέσμευση;")) return;

    setDeleting(true);
    setError(null);

    try {
      await ensureAnonymousUser();
      await deleteDoc(doc(db, "bookings", booking.booking_date));
      onDeleted(booking.id);
      void notifyAdmin("delete", booking).then(onEmailStatus);
    } catch (caughtError) {
      setError(firebaseMessage(caughtError, "Δεν ήταν δυνατή η ακύρωση της κράτησης."));
    } finally {
      setDeleting(false);
    }
  }

  const isCompleted = booking.status === "completed";

  return (
    <Modal onClose={deleting ? undefined : onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${isCompleted ? "text-violet-700" : "text-emerald-700"}`}>
            {isCompleted ? "Πραγματοποιημένη δράση" : "Δεσμευμένη ημερομηνία"}
          </p>
          <h3 className="mt-1 text-lg font-semibold capitalize">{formatDateGreek(booking.booking_date)}</h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isCompleted ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800"}`}>
          {isCompleted ? "Ολοκληρώθηκε" : "Κρατημένη"}
        </span>
      </div>

      <dl className="mt-6 space-y-4 text-sm">
        <DetailRow label="Θεραπευτής" value={booking.therapist_name} />
        <DetailRow label="Ώρα" value={booking.action_time} />
        <DetailRow label="Θέμα" value={booking.topic} />
        <DetailRow label="Περιγραφή" value={booking.description} />
        {!isCompleted && <DetailRow label="Δημόσιο πρόγραμμα" value={booking.is_public ? "Εμφανίζεται δημόσια" : "Δεν εμφανίζεται δημόσια"} />}
      </dl>

      {isCompleted && (
        <p className="mt-5 rounded-lg bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900">
          Αυτή η δράση έχει ήδη πραγματοποιηθεί και εμφανίζεται μόνο ως ιστορική καταγραφή.
        </p>
      )}

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {canManage && !isCompleted && (
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
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 leading-6 ${isEmpty ? "italic text-slate-400" : "text-slate-900"}`}>
        {isEmpty ? PLACEHOLDER : value}
      </dd>
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-2 sm:items-center sm:p-4"
      onClick={() => onClose?.()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="my-2 max-h-[calc(100vh-1rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:my-auto sm:max-h-[calc(100vh-2rem)] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
