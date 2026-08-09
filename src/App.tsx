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
type ActivityCategory = "association" | "association_free" | "therapist_independent";
type ApprovalStatus = "draft" | "pending" | "approved";

type Booking = {
  id: string;
  booking_date: string;
  therapist_name: string;
  additional_coordinator_name: string | null;
  coordinator_photo_url: string | null;
  additional_coordinator_photo_url: string | null;
  action_time: string | null;
  topic: string | null;
  description: string | null;
  event_type: string | null;
  mode: string | null;
  image_url: string | null;
  detail_image_url: string | null;
  long_description: string | null;
  audience: string | null;
  program_details: string | null;
  activity_category: ActivityCategory;
  general_price: string | null;
  offers_member_discount: boolean;
  member_price: string | null;
  requested_public: boolean;
  approval_status: ApprovalStatus;
  owner_uid: string;
  status: BookingStatus;
  is_public: boolean;
};

type TherapistDirectoryItem = {
  id: string;
  name: string;
  photo: string | null;
  city: string | null;
  profession: string | null;
};

type EventRegistration = {
  id: string;
  event_id: string;
  event_date: string;
  event_topic: string;
  event_time: string;
  full_name: string;
  email: string;
  phone: string;
  profession: string;
  membership_status: string;
  comment: string;
  created_at: string | null;
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
    therapist_name: "Ευαγγελία Ξανθοπούλου",
    additional_coordinator_name: "Μαρία Ζάχου",
    coordinator_photo_url: null,
    additional_coordinator_photo_url: null,
    action_time: "19:30 – 21:30",
    topic: "Από την εσωτερική ησυχία στην αυθεντική συνάντηση",
    description: "Πραγματοποιημένη δράση συλλόγου. Η ημερομηνία παραμένει ως ιστορική αναφορά.",
    event_type: "Εργαστήριο",
    mode: "Διαδικτυακά",
    image_url: "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194130.png",
    detail_image_url: null,
    long_description: null,
    audience: null,
    program_details: null,
    activity_category: "association_free",
    general_price: "0",
    offers_member_discount: false,
    member_price: null,
    requested_public: true,
    approval_status: "approved",
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

function getCurrentMonthKeyInGreece() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  if (!year || !month) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  return `${year}-${month}`;
}

function getTodayKeyInGreece() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function getCurrentMinutesInGreece() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function getEventEndMinutes(actionTime: string | null) {
  if (!actionTime) return null;

  const matches = Array.from(actionTime.matchAll(/(?:^|\D)(\d{1,2})[:.](\d{2})(?=\D|$)/g));
  if (matches.length < 2) return null;

  const last = matches[matches.length - 1];
  const hour = Number(last[1]);
  const minute = Number(last[2]);

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isBookingCompleted(booking: Booking) {
  if (booking.status === "completed") return true;

  const today = getTodayKeyInGreece();
  if (booking.booking_date < today) return true;
  if (booking.booking_date > today) return false;

  const endMinutes = getEventEndMinutes(booking.action_time);
  return endMinutes !== null ? getCurrentMinutesInGreece() >= endMinutes : false;
}

function getInitialMonthKey() {
  const currentKey = getCurrentMonthKeyInGreece();
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
    additional_coordinator_name:
      typeof data.additional_coordinator_name === "string" && data.additional_coordinator_name.trim()
        ? data.additional_coordinator_name.trim()
        : null,
    coordinator_photo_url:
      typeof data.coordinator_photo_url === "string" && data.coordinator_photo_url.trim()
        ? data.coordinator_photo_url
        : null,
    additional_coordinator_photo_url:
      typeof data.additional_coordinator_photo_url === "string" && data.additional_coordinator_photo_url.trim()
        ? data.additional_coordinator_photo_url
        : null,
    action_time: typeof data.action_time === "string" ? data.action_time : null,
    topic: typeof data.topic === "string" ? data.topic : null,
    description: typeof data.description === "string" ? data.description : null,
    event_type: typeof data.event_type === "string" ? data.event_type : null,
    mode: typeof data.mode === "string" ? data.mode : null,
    image_url: typeof data.image_url === "string" ? data.image_url : null,
    detail_image_url: typeof data.detail_image_url === "string" ? data.detail_image_url : null,
    long_description: typeof data.long_description === "string" ? data.long_description : null,
    audience: typeof data.audience === "string" ? data.audience : null,
    program_details: typeof data.program_details === "string" ? data.program_details : null,
    activity_category:
      data.activity_category === "association" ||
      data.activity_category === "association_free" ||
      data.activity_category === "therapist_independent"
        ? data.activity_category
        : "association_free",
    general_price: typeof data.general_price === "string" ? data.general_price : null,
    offers_member_discount: data.offers_member_discount === true,
    member_price: typeof data.member_price === "string" ? data.member_price : null,
    requested_public: data.requested_public === true || data.is_public === true,
    approval_status:
      data.approval_status === "pending" || data.approval_status === "draft"
        ? data.approval_status
        : data.is_public === true ? "approved" : "draft",
    owner_uid: String(data.owner_uid ?? ""),
    status: data.status === "completed" ? "completed" : "booked",
    is_public: data.is_public === true,
  };
}


async function compressImageFile(file: File | null): Promise<string> {
  if (!file) return "";

  return await new Promise<string>((resolve) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const maxDim = 900;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");

        if (!context) {
          resolve("");
          return;
        }

        context.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };

      img.onerror = () => resolve("");
      img.src = String(reader.result ?? "");
    };

    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
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

function normalizeTherapistName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:()"'’`´\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTherapistByName(
  name: string | null | undefined,
  therapists: TherapistDirectoryItem[],
) {
  const target = normalizeTherapistName(name);
  if (!target) return null;

  return therapists.find(
    (therapist) => normalizeTherapistName(therapist.name) === target,
  ) ?? null;
}

function coordinatorPhotoFor(
  name: string | null | undefined,
  therapists: TherapistDirectoryItem[],
  fallback?: string | null,
) {
  return findTherapistByName(name, therapists)?.photo || fallback || null;
}

async function loadTherapistDirectory(): Promise<TherapistDirectoryItem[]> {
  const url =
    "https://firestore.googleapis.com/v1/projects/syllogos-map/databases/(default)/documents/therapists?pageSize=500";

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const payload = await response.json();
    const documents = Array.isArray(payload.documents) ? payload.documents : [];

    return documents
      .map((document: any) => {
        const fields = document.fields ?? {};

        function stringField(name: string) {
          const field = fields[name];
          return field && typeof field.stringValue === "string"
            ? field.stringValue
            : null;
        }

        return {
          id: String(document.name ?? "").split("/").pop() ?? "",
          name: stringField("name") ?? "",
          photo: stringField("photo"),
          city: stringField("city"),
          profession: stringField("profession"),
        };
      })
      .filter((item: TherapistDirectoryItem) => Boolean(item.name));
  } catch {
    return [];
  }
}

function coordinatorsLabel(booking: Booking) {
  return [booking.therapist_name, booking.additional_coordinator_name]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" & ");
}

function activityCategoryLabel(booking: Booking) {
  if (booking.activity_category === "association_free") return "Δωρεάν Δράση Συλλόγου";
  if (booking.activity_category === "therapist_independent") return "Ανεξάρτητη Δράση Θεραπευτή Συλλόγου";
  return "Δράση Συλλόγου";
}

function activityCategoryClass(booking: Booking) {
  if (booking.activity_category === "association_free") return "category-free";
  if (booking.activity_category === "therapist_independent") return "category-independent";
  return "category-association";
}

function activityCategoryUnderline(booking: Booking) {
  if (booking.activity_category === "association_free") return "inset 0 -5px 0 #63A97E";
  if (booking.activity_category === "therapist_independent") return "inset 0 -5px 0 #79B9D3";
  return "inset 0 -5px 0 #E39A55";
}

function activityPriceLabel(booking: Booking) {
  if (booking.activity_category === "association_free") return "Δωρεάν";
  return booking.general_price ? `${booking.general_price} €` : "Δεν έχει οριστεί";
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
        additional_coordinator_name: booking.additional_coordinator_name,
        action_time: booking.action_time,
        topic: booking.topic,
        description: booking.description,
        activity_category: booking.activity_category,
        general_price: booking.general_price,
        offers_member_discount: booking.offers_member_discount,
        member_price: booking.member_price,
        requested_public: booking.requested_public,
        approval_status: booking.approval_status,
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


const MANAGE_ACCESS_KEY = "association-manage-code";
const MANAGE_ROLE_KEY = "association-manage-role";
type ManageRole = "member" | "admin";

function getManageCode() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(MANAGE_ACCESS_KEY) || "";
}

function getManageRole(): ManageRole | null {
  if (typeof window === "undefined") return null;
  const role = window.sessionStorage.getItem(MANAGE_ROLE_KEY);
  return role === "admin" || role === "member" ? role : null;
}


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
  const [role, setRole] = useState<ManageRole | null>(() => getManageRole());
  const [unlocked, setUnlocked] = useState(() => Boolean(getManageCode() && getManageRole()));
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);

    try {
      const response = await fetch("/api/verify-manage-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (payload.role !== "member" && payload.role !== "admin")) {
        throw new Error("INVALID_CODE");
      }

      window.sessionStorage.setItem(MANAGE_ACCESS_KEY, code.trim());
      window.sessionStorage.setItem(MANAGE_ROLE_KEY, payload.role);
      setRole(payload.role);
      setUnlocked(true);
      setCode("");
    } catch {
      setError("Ο κωδικός δεν είναι σωστός.");
      setCode("");
    } finally {
      setChecking(false);
    }
  }

  if (unlocked && role) {
    return (
      <>
        <ManageApp role={role} />
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(MANAGE_ACCESS_KEY);
            window.sessionStorage.removeItem(MANAGE_ROLE_KEY);
            setRole(null);
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
          Με τον κωδικό μελών ανοίγει η διαχείριση δράσεων. Με τον κωδικό διοικητικού εμφανίζονται επιπλέον τα προσωπικά στοιχεία των συμμετεχόντων.
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
              disabled={checking}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-xl tracking-[0.4em] focus:border-emerald-500 focus:outline-none disabled:bg-slate-100"
              placeholder="••••"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={checking} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {checking ? "Έλεγχος…" : "Είσοδος"}
          </button>
        </form>

        <a href="/events" className="mt-5 block text-center text-xs font-medium text-slate-500 hover:text-emerald-700">
          Επιστροφή στο δημόσιο πρόγραμμα
        </a>
      </div>
    </div>
  );
}

function ManageApp({ role }: { role: ManageRole }) {
  const [activeMonth, setActiveMonth] = useState(() => getInitialMonthKey());
  const [bookings, setBookings] = useState<Booking[]>(STATIC_BOOKINGS);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [registrationsBooking, setRegistrationsBooking] = useState<Booking | null>(null);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setActiveMonth(getInitialMonthKey());
  }, []);

  async function loadRegistrationCounts() {
    const code = getManageCode();
    if (!code) return;
    try {
      const response = await fetch(`/api/event-registrations?summary=1&code=${encodeURIComponent(code)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error("SUMMARY_FAILED"), { code: payload.code || `HTTP_${response.status}` });
      setRegistrationCounts(payload.counts || {});
      setRegistrationError(null);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      setRegistrationError(`Δεν φορτώθηκαν οι συμμετοχές${code ? ` (${code})` : ""}. Έλεγξε τις ρυθμίσεις Firebase Admin στο Vercel.`);
    }
  }

  useEffect(() => {
    void loadRegistrationCounts();
    const handleFocus = () => void loadRegistrationCounts();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

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
    <div className="sepsyg-manage-page min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
          <AssociationLogo size="sm" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Κοινό ημερολόγιο συλλόγου</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${role === "admin" ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800"}`}>
              {role === "admin" ? "Πρόσβαση διοικητικού" : "Πρόσβαση μέλους"}
            </span>
          </div>
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

        {registrationError && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="font-semibold">Λίστες συμμετοχών:</strong> {registrationError}
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
                  const status = booking ? (isBookingCompleted(booking) ? "completed" : "booked") : null;

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
                      style={booking ? { boxShadow: activityCategoryUnderline(booking) } : undefined}
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
                            {coordinatorsLabel(booking)}
                          </span>
                          {booking.topic && (
                            <span className={`mt-1 hidden line-clamp-2 text-[11px] leading-4 sm:block ${status === "completed" ? "text-violet-800" : "text-slate-700"}`}>
                              {booking.topic}
                            </span>
                          )}
                          {booking.approval_status === "pending" && (
                            <span className="mt-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white sm:text-[10px]">
                              Αναμονή έγκρισης
                            </span>
                          )}
                          {booking.is_public && (registrationCounts[date] || 0) > 0 && (
                            <span className="mt-1 rounded-full bg-sky-700 px-1.5 py-0.5 text-[9px] font-bold text-white sm:text-[10px]">
                              {registrationCounts[date]} συμμετοχές
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

      </main>

      {selectedDate && (
        <BookingForm
          date={selectedDate}
          manageRole={role}
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
          registrationCount={registrationCounts[viewBooking.booking_date] || 0}
          canViewRegistrationDetails={role === "admin"}
          onViewRegistrations={() => {
            const booking = viewBooking;
            setViewBooking(null);
            setRegistrationsBooking(booking);
          }}
          onClose={() => setViewBooking(null)}
          canApprove={role === "admin" && viewBooking.approval_status === "pending"}
          onApproved={(approvedBooking) => {
            setBookings((previous) => mergeBookings([
              ...previous.filter((item) => item.id !== approvedBooking.id),
              approvedBooking,
            ]));
            setViewBooking(approvedBooking);
          }}
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
          manageRole={role}
          connectionError={connectionError}
          onEmailStatus={reportEmailStatus}
          onClose={() => setEditBooking(null)}
          onSaved={(booking) => {
            setBookings((previous) => mergeBookings([...previous.filter((item) => item.id !== booking.id), booking]));
            setEditBooking(null);
          }}
        />
      )}

      {role === "admin" && registrationsBooking && (
        <RegistrationsModal
          booking={registrationsBooking}
          onClose={() => {
            setRegistrationsBooking(null);
            void loadRegistrationCounts();
          }}
          onCountChange={(count) => setRegistrationCounts((previous) => ({ ...previous, [registrationsBooking.booking_date]: count }))}
        />
      )}
    </div>
  );
}


function ActivityCard({
  booking,
  therapistDirectory,
  onOpen,
}: {
  booking: Booking;
  therapistDirectory: TherapistDirectoryItem[];
  onOpen: () => void;
}) {
  const completed = isBookingCompleted(booking);
  const mainCoordinatorPhoto = coordinatorPhotoFor(
    booking.therapist_name,
    therapistDirectory,
    booking.coordinator_photo_url,
  );
  return (
    <article className={`sepsyg-event-card ${activityCategoryClass(booking)}`}>
      <div className="sepsyg-event-image">
        {booking.image_url ? (
          <img src={booking.image_url} alt={booking.topic || "Δράση Συλλόγου"} loading="lazy" />
        ) : (
          <div className="sepsyg-event-placeholder"><img src="/logo.png" alt="" /></div>
        )}
        <span className={`sepsyg-event-type ${activityCategoryClass(booking)}`}>{activityCategoryLabel(booking)}</span>
      </div>
      <div className="sepsyg-event-body">
        <div className="sepsyg-event-topline">
          <span className={`sepsyg-auto-status ${completed ? "past" : "future"}`}>
            {completed ? "Ολοκληρώθηκε" : "Προσεχώς"}
          </span>
          {booking.mode && <span className="sepsyg-event-mode">{booking.mode}</span>}
        </div>
        <h3>{booking.topic || "Δράση Συλλόγου"}</h3>
        {booking.description && <p className="sepsyg-event-desc">{booking.description}</p>}
        <div className="sepsyg-event-meta">
          <span>📅 {formatDateGreek(booking.booking_date)}</span>
          <span>🕒 {booking.action_time || "Η ώρα θα ανακοινωθεί"}</span>
          {booking.therapist_name && (
            <span className="sepsyg-card-coordinator">
              <span className="sepsyg-card-coordinator-photo">
                {mainCoordinatorPhoto ? (
                  <img src={mainCoordinatorPhoto} alt="" loading="lazy" />
                ) : (
                  booking.therapist_name.charAt(0)
                )}
              </span>
              <span>{coordinatorsLabel(booking)}</span>
            </span>
          )}
          <span>💶 {activityPriceLabel(booking)}</span>
          {booking.offers_member_discount && booking.member_price && <span>★ Μέλη / Φίλοι: {booking.member_price} €</span>}
        </div>
        <button type="button" className="sepsyg-event-action" onClick={onOpen}>
          Δείτε περισσότερα
        </button>
      </div>
    </article>
  );
}

function PublicEventsApp() {
  type PublicView = "calendar" | "all" | "upcoming";
  const [activeMonth, setActiveMonth] = useState(() => getInitialMonthKey());
  const [activeView, setActiveView] = useState<PublicView>("calendar");
  const [bookings, setBookings] = useState<Booking[]>(STATIC_BOOKINGS);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessChecking, setAccessChecking] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [therapistDirectory, setTherapistDirectory] = useState<TherapistDirectoryItem[]>([]);

  useEffect(() => {
    setActiveMonth(getInitialMonthKey());
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadTherapistDirectory().then((items) => {
      if (!cancelled) setTherapistDirectory(items);
    });

    return () => {
      cancelled = true;
    };
  }, []);

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

  const today = getTodayKeyInGreece();
  useEffect(() => {
    if (deepLinkHandled || loading || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const eventId = params.get("event");

    if (requestedView === "all" || requestedView === "upcoming" || requestedView === "calendar") {
      setActiveView(requestedView);
    }

    if (eventId) {
      const linkedBooking = bookings.find(
        (booking) => booking.booking_date === eventId && booking.is_public,
      );

      if (linkedBooking) {
        setViewBooking(linkedBooking);
        if (!requestedView) {
          setActiveView(isBookingCompleted(linkedBooking) ? "all" : "upcoming");
        }
      }
    }

    setDeepLinkHandled(true);
  }, [bookings, deepLinkHandled, loading]);

  const publicBookings = useMemo(
    () => bookings.filter((booking) => booking.is_public).sort((a, b) => a.booking_date.localeCompare(b.booking_date)),
    [bookings],
  );

  const publicBookingsByDate = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const booking of publicBookings) map.set(booking.booking_date, booking);
    return map;
  }, [publicBookings]);

  const upcomingBookings = useMemo(
    () => publicBookings.filter((booking) => !isBookingCompleted(booking)),
    [publicBookings, today],
  );

  const allCards = useMemo(() => {
    const upcoming = publicBookings.filter((booking) => !isBookingCompleted(booking));
    const past = publicBookings.filter((booking) => isBookingCompleted(booking)).reverse();
    return [...upcoming, ...past];
  }, [publicBookings, today]);

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
  const visibleCards = activeView === "upcoming" ? upcomingBookings : allCards;

  async function handlePublicAccess(event: FormEvent) {
    event.preventDefault();
    setAccessChecking(true);
    setAccessError(null);

    try {
      const response = await fetch("/api/verify-manage-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCode.trim() }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (payload.role !== "member" && payload.role !== "admin")) {
        throw new Error("INVALID_CODE");
      }

      window.sessionStorage.setItem(MANAGE_ACCESS_KEY, accessCode.trim());
      window.sessionStorage.setItem(MANAGE_ROLE_KEY, payload.role);
      window.location.href = "/manage";
    } catch {
      setAccessError("Ο κωδικός δεν είναι σωστός.");
      setAccessCode("");
    } finally {
      setAccessChecking(false);
    }
  }

  return (
    <div className="sepsyg-public-page">
      <button
        type="button"
        className="sepsyg-discreet-access"
        onClick={() => {
          setAccessError(null);
          setAccessCode("");
          setAccessOpen(true);
        }}
        aria-label="Είσοδος στη διαχείριση"
        title="Είσοδος στη διαχείριση"
      >
        +
      </button>

      <header className="sepsyg-public-hero">
        <div className="sepsyg-public-wrap sepsyg-hero-inner">
          <AssociationLogo size="sm" centered />
          <p className="sepsyg-kicker">Ημερολόγιο Συλλόγου</p>
          <h1>Δράσεις &amp; Εκδηλώσεις</h1>
          <p className="sepsyg-hero-copy">
            Σεμινάρια, βιωματικά εργαστήρια και συναντήσεις του Πανευρωπαϊκού Επιστημονικού Συλλόγου Σ.Ε.ΨΥ.G.
          </p>
          <nav className="sepsyg-view-tabs" aria-label="Προβολή δράσεων">
            <button className={activeView === "calendar" ? "active" : ""} onClick={() => setActiveView("calendar")}>Ημερολόγιο</button>
            <button className={activeView === "all" ? "active" : ""} onClick={() => setActiveView("all")}>Όλες οι δράσεις</button>
            <button className={activeView === "upcoming" ? "active" : ""} onClick={() => setActiveView("upcoming")}>Προσεχείς δράσεις</button>
          </nav>
        </div>
      </header>

      <main className="sepsyg-public-wrap sepsyg-public-main">
        {connectionError && <div className="sepsyg-alert"><strong>Πρόβλημα σύνδεσης:</strong> {connectionError}</div>}

        {activeView === "calendar" ? (
          <>
            <div className="sepsyg-month-select">
              <label htmlFor="events-month">Επιλογή μήνα</label>
              <select id="events-month" value={activeMonth} onChange={(event) => setActiveMonth(event.target.value)}>
                {MONTHS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
              <nav aria-label="Επιλογή μήνα" className="sepsyg-month-pills">
                {MONTHS.map((item) => (
                  <button key={item.key} type="button" onClick={() => setActiveMonth(item.key)} className={activeMonth === item.key ? "active" : ""}>
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <section className="sepsyg-calendar-card">
              <div className="sepsyg-calendar-title">
                <h2>{month.label}</h2>
                <span>{loading ? "Φόρτωση…" : `${monthEvents.length} δράσεις`}</span>
              </div>
              <div className="sepsyg-calendar-body">
                <div className="sepsyg-weekdays">
                  {WEEKDAYS.map((weekday) => <div key={weekday}>{weekday}</div>)}
                </div>
                <div className="sepsyg-calendar-grid">
                  {calendarCells.map((day, index) => {
                    if (day === null) return <div key={`empty-${index}`} className="sepsyg-day empty" />;
                    const date = toDateString(month.year, month.month, day);
                    const booking = publicBookingsByDate.get(date);
                    const isCompleted = booking ? isBookingCompleted(booking) : false;
                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!booking}
                        onClick={() => booking && setViewBooking(booking)}
                        className={`sepsyg-day ${booking ? (isCompleted ? "completed" : "upcoming") : ""} ${booking ? activityCategoryClass(booking) : ""}`}
                      >
                        <span className="day-number">{day}</span>
                        {booking && (
                          <>
                            <span className="day-status">{isCompleted ? "Πραγματοποιήθηκε" : "Προσεχώς"}</span>
                            <span className="sepsyg-day-coordinator-photo">
                              {coordinatorPhotoFor(booking.therapist_name, therapistDirectory, booking.coordinator_photo_url) ? (
                                <img
                                  src={coordinatorPhotoFor(booking.therapist_name, therapistDirectory, booking.coordinator_photo_url) || ""}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                booking.therapist_name.charAt(0)
                              )}
                            </span>
                            <strong>{booking.topic || "Δράση Συλλόγου"}</strong>
                            {booking.action_time && <small>{booking.action_time}</small>}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="sepsyg-month-events">
              <div className="sepsyg-section-heading"><span>Αναλυτικά</span><h2>Δράσεις του μήνα</h2></div>
              {monthEvents.length ? (
                <div className="sepsyg-events-grid">
                  {monthEvents.map((booking) => <ActivityCard
                    key={booking.id}
                    booking={booking}
                    therapistDirectory={therapistDirectory}
                    onOpen={() => setViewBooking(booking)}
                  />)}
                </div>
              ) : <div className="sepsyg-empty-state">Δεν υπάρχουν δημοσιευμένες δράσεις για αυτόν τον μήνα.</div>}
            </section>
          </>
        ) : (
          <section className="sepsyg-list-view">
            <div className="sepsyg-section-heading centered">
              <span>{activeView === "upcoming" ? "Τι έρχεται" : "Αρχείο & προσεχείς"}</span>
              <h2>{activeView === "upcoming" ? "Προσεχείς δράσεις" : "Όλες οι δράσεις"}</h2>
              <p>{activeView === "upcoming" ? "Διάλεξε τη δράση που σε ενδιαφέρει και δήλωσε τη συμμετοχή σου." : "Όλες οι δημοσιευμένες δράσεις του Συλλόγου σε μία ενιαία προβολή."}</p>
            </div>
            {visibleCards.length ? (
              <div className="sepsyg-events-grid">
                {visibleCards.map((booking) => <ActivityCard
                    key={booking.id}
                    booking={booking}
                    therapistDirectory={therapistDirectory}
                    onOpen={() => setViewBooking(booking)}
                  />)}
              </div>
            ) : <div className="sepsyg-empty-state">Δεν υπάρχουν διαθέσιμες δράσεις αυτή τη στιγμή.</div>}
          </section>
        )}

        <div className="sepsyg-public-links">
          <a href="https://eusyllogossepshyg.carrd.co/" target="_blank" rel="noreferrer">Ιστοσελίδα Συλλόγου</a>
        </div>
      </main>

      {accessOpen && (
        <div className="sepsyg-access-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !accessChecking) setAccessOpen(false);
        }}>
          <div className="sepsyg-access-card" role="dialog" aria-modal="true" aria-labelledby="sepsyg-access-title">
            <button
              type="button"
              className="sepsyg-access-close"
              onClick={() => !accessChecking && setAccessOpen(false)}
              aria-label="Κλείσιμο"
            >
              ×
            </button>

            <p className="sepsyg-access-kicker">Περιοχή διαχείρισης</p>
            <h2 id="sepsyg-access-title">Είσοδος</h2>
            <p className="sepsyg-access-copy">
              Η πρόσβαση θεραπευτή επιτρέπει διαχείριση δράσεων.
              Η διοικητική πρόσβαση εμφανίζει επιπλέον τις λίστες και τα στοιχεία συμμετεχόντων.
            </p>

            <form onSubmit={handlePublicAccess}>
              <label htmlFor="public-manage-code">Κωδικός πρόσβασης</label>
              <input
                id="public-manage-code"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="••••"
                autoFocus
                required
                disabled={accessChecking}
              />

              {accessError && <p className="sepsyg-access-error">{accessError}</p>}

              <button type="submit" className="sepsyg-access-submit" disabled={accessChecking}>
                {accessChecking ? "Έλεγχος…" : "Σύνδεση"}
              </button>
            </form>
          </div>
        </div>
      )}

      {viewBooking && (
        <PublicBookingDetails
          booking={viewBooking}
          therapistDirectory={therapistDirectory}
          onClose={() => setViewBooking(null)}
        />
      )}
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

type EventRegistrationFormValues = {
  fullName: string;
  email: string;
  phone: string;
  profession: string;
  membershipStatus: string;
  comment: string;
};

function PublicBookingDetails({
  booking,
  therapistDirectory,
  onClose,
}: {
  booking: Booking;
  therapistDirectory: TherapistDirectoryItem[];
  onClose: () => void;
}) {
  const isCompleted = isBookingCompleted(booking);
  const mainTherapist = findTherapistByName(booking.therapist_name, therapistDirectory);
  const additionalTherapist = findTherapistByName(booking.additional_coordinator_name, therapistDirectory);
  const mainCoordinatorPhoto = mainTherapist?.photo || booking.coordinator_photo_url;
  const additionalCoordinatorPhoto =
    additionalTherapist?.photo || booking.additional_coordinator_photo_url;
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState<EventRegistrationFormValues>({ fullName: "", email: "", phone: "", profession: "", membershipStatus: "", comment: "" });
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function updateValue(field: keyof EventRegistrationFormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  async function handleRegistration(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!consent) {
      setNotice({ ok: false, text: "Χρειάζεται να αποδεχτείς τη χρήση των στοιχείων για τη συγκεκριμένη συμμετοχή." });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/register-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: booking.booking_date, ...values, consent, website }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.code || "REQUEST_FAILED"), { code: payload.code || `HTTP_${response.status}` });
      setValues({ fullName: "", email: "", phone: "", profession: "", membershipStatus: "", comment: "" });
      setConsent(false);
      setWebsite("");
      setNotice({ ok: true, text: payload.emailWarning ? "Η συμμετοχή σου καταχωρίστηκε. Δεν στάλθηκε μόνο το email επιβεβαίωσης." : "Η συμμετοχή σου καταχωρίστηκε και στάλθηκε επιβεβαίωση στο email σου." });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ALREADY_REGISTERED") setNotice({ ok: false, text: "Υπάρχει ήδη συμμετοχή με αυτό το email για τη συγκεκριμένη δράση." });
      else if (code === "EVENT_NOT_OPEN") setNotice({ ok: false, text: "Η συγκεκριμένη δράση δεν δέχεται πλέον συμμετοχές." });
      else setNotice({ ok: false, text: `Δεν ήταν δυνατή η καταχώριση${code ? ` (${code})` : ""}. Δοκίμασε ξανά.` });
    } finally { setSubmitting(false); }
  }

  return (
    <Modal onClose={submitting ? undefined : onClose} wide>
      <div className="overflow-hidden rounded-[26px] bg-[#FFF9F3]">
        {booking.image_url ? (
          <div className="h-56 overflow-hidden bg-[#DCE4DE] sm:h-72">
            <img
              src={booking.image_url}
              alt={booking.topic || "Δράση Συλλόγου"}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="h-28 bg-gradient-to-br from-[#9EB2A6] to-[#E1AF85]" />
        )}

        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${activityCategoryClass(booking)}`}>
              {activityCategoryLabel(booking)}
            </span>
            {booking.event_type && (
              <span className="rounded-full bg-[#174B49] px-3 py-1.5 text-xs font-bold text-white">
                {booking.event_type}
              </span>
            )}
            {booking.mode && (
              <span className="rounded-full bg-[#008D8B]/10 px-3 py-1.5 text-xs font-bold text-[#006B68]">
                {booking.mode}
              </span>
            )}
          </div>

          <h3 className="mt-4 font-serif text-3xl font-medium leading-tight text-[#174B49] sm:text-4xl">
            {booking.topic || "Δράση Συλλόγου"}
          </h3>

          {booking.description && (
            <p className="mt-4 text-[15px] leading-7 text-[#627472]">
              {booking.description}
            </p>
          )}

          <div className="mt-6 grid gap-3 rounded-2xl border border-[#174B49]/10 bg-white p-5 sm:grid-cols-2">
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">Ημερομηνία</span>
              <p className="mt-1 text-sm font-semibold text-[#263B39]">{formatDateGreek(booking.booking_date)}</p>
            </div>
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">Ώρα</span>
              <p className="mt-1 text-sm font-semibold text-[#263B39]">{booking.action_time || "Θα ανακοινωθεί"}</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">Συντονιστές</span>
              <p className="mt-1 text-sm font-semibold text-[#263B39]">{coordinatorsLabel(booking)}</p>
            </div>
          </div>

          <section className={`mt-5 rounded-2xl border p-5 ${activityCategoryClass(booking)} price-panel`}>
            <div className="text-[11px] font-extrabold uppercase tracking-[.13em]">Κόστος συμμετοχής</div>
            <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
              <p className="m-0 text-2xl font-bold">{activityPriceLabel(booking)}</p>
              {booking.offers_member_discount && booking.member_price && (
                <p className="m-0 text-sm font-bold">Μέλη &amp; Φίλοι: {booking.member_price} €</p>
              )}
            </div>
          </section>

          {booking.long_description && (
            <section className="mt-8">
              <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Η δράση</p>
              <h4 className="mt-2 font-serif text-2xl font-medium text-[#174B49]">Περισσότερες πληροφορίες</h4>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-8 text-[#566966]">
                {booking.long_description}
              </p>
            </section>
          )}

          {booking.detail_image_url && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-[#174B49]/10 bg-white">
              <img
                src={booking.detail_image_url}
                alt=""
                className="max-h-[430px] w-full object-cover"
              />
            </div>
          )}

          {booking.audience && (
            <section className="mt-7 rounded-2xl bg-[#9EB2A6]/15 p-5 sm:p-6">
              <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Σε ποιους απευθύνεται</p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-[#425754]">
                {booking.audience}
              </p>
            </section>
          )}

          {booking.program_details && (
            <section className="mt-5 rounded-2xl border border-[#174B49]/10 bg-white p-5 sm:p-6">
              <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Πρόγραμμα / Θεματικές</p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-[#425754]">
                {booking.program_details}
              </p>
            </section>
          )}

          {(booking.therapist_name || booking.additional_coordinator_name) && (
            <section className="sepsyg-coordinator-section">
              <h4>Συντονίζει:</h4>

              <div className="sepsyg-coordinator-grid">
                {booking.therapist_name && (
                  <div className="sepsyg-coordinator-card">
                    <div className="sepsyg-coordinator-avatar">
                      {mainCoordinatorPhoto ? (
                        <img src={mainCoordinatorPhoto} alt={booking.therapist_name} />
                      ) : (
                        <span>{booking.therapist_name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="sepsyg-coordinator-copy">
                      <strong>{booking.therapist_name}</strong>
                      {mainTherapist && (
                        <small>
                          {[mainTherapist.profession, mainTherapist.city].filter(Boolean).join(" · ")}
                        </small>
                      )}
                    </div>
                  </div>
                )}

                {booking.additional_coordinator_name && (
                  <div className="sepsyg-coordinator-card">
                    <div className="sepsyg-coordinator-avatar">
                      {additionalCoordinatorPhoto ? (
                        <img src={additionalCoordinatorPhoto} alt={booking.additional_coordinator_name} />
                      ) : (
                        <span>{booking.additional_coordinator_name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="sepsyg-coordinator-copy">
                      <strong>{booking.additional_coordinator_name}</strong>
                      {additionalTherapist && (
                        <small>
                          {[additionalTherapist.profession, additionalTherapist.city].filter(Boolean).join(" · ")}
                        </small>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {!isCompleted && !showForm && (
            <div className="mt-8 flex flex-col gap-3 border-t border-[#174B49]/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[#627472]">Θέλεις να κρατήσεις θέση στη συγκεκριμένη δράση;</p>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="rounded-full bg-[#008D8B] px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-[#008D8B]/15"
              >
                Δήλωσε συμμετοχή
              </button>
            </div>
          )}

          {!isCompleted && showForm && (
            <form onSubmit={handleRegistration} className="sepsyg-registration-form mt-8">
              <div className="form-intro">
                <h4>Δήλωση συμμετοχής</h4>
                <p>Συμπλήρωσε τα στοιχεία σου. Η φόρμα συνδέεται αυτόματα με αυτή τη δράση.</p>
              </div>

              <div className="sepsyg-form-grid">
                <label>Ονοματεπώνυμο<input value={values.fullName} onChange={(event) => updateValue("fullName", event.target.value)} required maxLength={160} /></label>
                <label>Email<input type="email" value={values.email} onChange={(event) => updateValue("email", event.target.value)} required maxLength={220} /></label>
                <label>Τηλέφωνο<input type="tel" value={values.phone} onChange={(event) => updateValue("phone", event.target.value)} required maxLength={60} /></label>
                <label>Επάγγελμα<input value={values.profession} onChange={(event) => updateValue("profession", event.target.value)} required maxLength={160} /></label>
              </div>

              <label className="sepsyg-full-field">
                Σχέση με τον Σύλλογο
                <select
                  value={values.membershipStatus}
                  onChange={(event) => updateValue("membershipStatus", event.target.value)}
                  required
                >
                  <option value="" disabled>Επίλεξε</option>
                  <option value="none">Δεν είμαι Μέλος ή Φίλος του Συλλόγου</option>
                  <option value="friend">Είμαι Φίλος του Συλλόγου</option>
                  <option value="member">Είμαι Μέλος του Συλλόγου</option>
                  <option value="want_member">Θέλω να γίνω Μέλος του Συλλόγου</option>
                </select>
                <small className="sepsyg-discount-note">
                  * Οι Φίλοι και τα Μέλη έχουν έκπτωση σε όλες τις δράσεις του Συλλόγου.
                  Η έκπτωση διαμορφώνεται σε συνεννόηση με τον θεραπευτή που διοργανώνει το Σεμινάριο / Εργαστήριο.
                </small>
              </label>

              <label className="sepsyg-full-field">
                Σχόλιο <small>(προαιρετικό)</small>
                <textarea rows={3} value={values.comment} onChange={(event) => updateValue("comment", event.target.value)} maxLength={1000} />
              </label>

              <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
              </div>

              <label className="sepsyg-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>Αποδέχομαι τη χρήση των στοιχείων μου αποκλειστικά για τη διαχείριση της συμμετοχής μου και την επικοινωνία από τον Σύλλογο.</span>
              </label>

              {notice && <p className={`sepsyg-form-notice ${notice.ok ? "success" : "error"}`}>{notice.text}</p>}

              <div className="sepsyg-form-actions">
                <button type="button" className="secondary" disabled={submitting} onClick={() => setShowForm(false)}>Πίσω</button>
                <button type="submit" disabled={submitting || notice?.ok === true}>
                  {submitting ? "Καταχώριση…" : notice?.ok ? "Η συμμετοχή καταχωρίστηκε" : "Ολοκλήρωση συμμετοχής"}
                </button>
              </div>
            </form>
          )}

          <div className="mt-7 border-t border-[#174B49]/10 pt-5 text-center">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-sm font-bold text-[#627472] hover:text-[#174B49]"
            >
              Κλείσιμο
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const path = typeof window === "undefined" ? "/" : window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/manage" ? <ManageAccess /> : <PublicEventsApp />;
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
  manageRole,
  onEmailStatus,
  onClose,
  onSaved,
}: {
  date: string;
  existing?: Booking;
  connectionError?: string | null;
  manageRole: ManageRole;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [name, setName] = useState(existing?.therapist_name ?? "");
  const [additionalCoordinator, setAdditionalCoordinator] = useState(existing?.additional_coordinator_name ?? "");
  const [time, setTime] = useState(existing?.action_time ?? "");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [eventType, setEventType] = useState(existing?.event_type ?? "Σεμινάριο");
  const [mode, setMode] = useState(existing?.mode ?? "Διαδικτυακά");
  const [imageUrl, setImageUrl] = useState(existing?.image_url ?? "");
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [detailImageFile, setDetailImageFile] = useState<File | null>(null);
  const [longDescription, setLongDescription] = useState(existing?.long_description ?? "");
  const [audience, setAudience] = useState(existing?.audience ?? "");
  const [programDetails, setProgramDetails] = useState(existing?.program_details ?? "");
  const [activityCategory, setActivityCategory] = useState<ActivityCategory>(existing?.activity_category ?? "association");
  const [generalPrice, setGeneralPrice] = useState(existing?.general_price ?? "");
  const [offersMemberDiscount, setOffersMemberDiscount] = useState(existing?.offers_member_discount ?? false);
  const [memberPrice, setMemberPrice] = useState(existing?.member_price ?? "");
  const [coordinatorPhotoFile, setCoordinatorPhotoFile] = useState<File | null>(null);
  const [additionalCoordinatorPhotoFile, setAdditionalCoordinatorPhotoFile] = useState<File | null>(null);
  const [laterTime, setLaterTime] = useState(existing ? existing.action_time === null : false);
  const [laterTopic, setLaterTopic] = useState(existing ? existing.topic === null : false);
  const [laterDescription, setLaterDescription] = useState(existing ? existing.description === null : false);
  const [isPublic, setIsPublic] = useState(existing ? (existing.is_public || existing.requested_public) : false);
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

    if (isPublic && activityCategory !== "association_free" && !generalPrice.trim()) {
      setError("Για δημοσίευση πληρωμένης δράσης, συμπλήρωσε τη γενική τιμή.");
      return;
    }

    if (isPublic && offersMemberDiscount && !memberPrice.trim()) {
      setError("Συμπλήρωσε την ειδική τιμή για Μέλη και Φίλους του Συλλόγου.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const user = await ensureAnonymousUser();
      const bookingRef = doc(db, "bookings", date);
      const uploadedCover = coverImageFile
        ? await compressImageFile(coverImageFile)
        : "";

      const uploadedDetail = detailImageFile
        ? await compressImageFile(detailImageFile)
        : "";

      const uploadedCoordinatorPhoto = coordinatorPhotoFile
        ? await compressImageFile(coordinatorPhotoFile)
        : "";

      const uploadedAdditionalCoordinatorPhoto = additionalCoordinatorPhotoFile
        ? await compressImageFile(additionalCoordinatorPhotoFile)
        : "";

      const values = {
        booking_date: date,
        therapist_name: name.trim(),
        additional_coordinator_name: additionalCoordinator.trim() || null,
        coordinator_photo_url:
          uploadedCoordinatorPhoto || existing?.coordinator_photo_url || null,
        additional_coordinator_photo_url:
          uploadedAdditionalCoordinatorPhoto || existing?.additional_coordinator_photo_url || null,
        action_time: laterTime ? null : time.trim() || null,
        topic: laterTopic ? null : topic.trim() || null,
        description: laterDescription ? null : description.trim() || null,
        event_type: eventType.trim() || null,
        mode: mode.trim() || null,
        image_url: uploadedCover || imageUrl.trim() || existing?.image_url || null,
        detail_image_url: uploadedDetail || existing?.detail_image_url || null,
        long_description: longDescription.trim() || null,
        audience: audience.trim() || null,
        program_details: programDetails.trim() || null,
        activity_category: activityCategory,
        general_price: activityCategory === "association_free" ? "0" : generalPrice.trim() || null,
        offers_member_discount: activityCategory === "association_free" ? false : (isPublic && offersMemberDiscount),
        member_price: activityCategory === "association_free" || !isPublic || !offersMemberDiscount ? null : memberPrice.trim() || null,
        requested_public: isPublic,
        approval_status: isPublic ? (manageRole === "admin" ? "approved" : "pending") : "draft",
        status: "booked" as BookingStatus,
        is_public: isPublic && manageRole === "admin",
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
            Βασικός συντονιστής / θεραπευτής <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            placeholder="Ονοματεπώνυμο"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="additional-coordinator">
            Επιπλέον συντονιστής <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="additional-coordinator"
            type="text"
            value={additionalCoordinator}
            onChange={(event) => setAdditionalCoordinator(event.target.value)}
            placeholder="Ονοματεπώνυμο δεύτερου συντονιστή"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Αν το ίδιο ονοματεπώνυμο υπάρχει στον χάρτη θεραπευτών, η δημόσια δράση θα μπορεί να εμφανίζεται αυτόματα και στο προφίλ του δεύτερου συντονιστή.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/35 p-4">
          <label className="mb-1.5 block text-sm font-semibold text-emerald-950" htmlFor="coordinator-photo">
            Φωτογραφία βασικού συντονιστή <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="coordinator-photo"
            type="file"
            accept="image/*"
            onChange={(event) => setCoordinatorPhotoFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm"
          />
          <p className="mt-2 text-xs leading-5 text-slate-500">
            * Αν είσαι στον Χάρτη Θεραπευτών Σ.Ε.ΨΥ.G., η φωτογραφία σου θα μπει αυτόματα.
            Αν δεν είσαι καταχωρισμένος στον Χάρτη, μπορείς να ανεβάσεις εδώ τη φωτογραφία σου.
          </p>
        </div>

        {additionalCoordinator.trim() && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <label className="mb-1.5 block text-sm font-semibold text-slate-900" htmlFor="additional-coordinator-photo">
              Φωτογραφία επιπλέον συντονιστή <span className="font-normal text-slate-400">(προαιρετικό)</span>
            </label>
            <input
              id="additional-coordinator-photo"
              type="file"
              accept="image/*"
              onChange={(event) => setAdditionalCoordinatorPhotoFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              * Αν ο επιπλέον συντονιστής βρίσκεται στον Χάρτη Θεραπευτών Σ.Ε.ΨΥ.G.,
              η φωτογραφία του θα μπει αυτόματα.
            </p>
          </div>
        )}


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

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="mb-1.5 block text-sm font-semibold text-slate-900" htmlFor="activity-category">
            Κατηγορία δράσης
          </label>
          <select
            id="activity-category"
            value={activityCategory}
            onChange={(event) => {
              const next = event.target.value as ActivityCategory;
              setActivityCategory(next);
              if (next === "association_free") {
                setGeneralPrice("");
                setOffersMemberDiscount(false);
                setMemberPrice("");
              }
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="association">Δράση Συλλόγου</option>
            <option value="association_free">Δωρεάν Δράση Συλλόγου</option>
            <option value="therapist_independent">Ανεξάρτητη Δράση Θεραπευτή Συλλόγου</option>
          </select>

          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-600">
            <span className="border-b-4 border-[#63A97E] pb-1">Πράσινο · Δωρεάν</span>
            <span className="border-b-4 border-[#E39A55] pb-1">Πορτοκαλί · Δράση Συλλόγου</span>
            <span className="border-b-4 border-[#79B9D3] pb-1">Γαλάζιο · Ανεξάρτητη</span>
          </div>
        </div>

        {activityCategory !== "association_free" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="general-price">
              Γενική τιμή (€)
            </label>
            <input
              id="general-price"
              type="number"
              min="0"
              step="0.01"
              value={generalPrice}
              onChange={(event) => setGeneralPrice(event.target.value)}
              placeholder="π.χ. 30"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="event-type">Τύπος δράσης</label>
            <select id="event-type" value={eventType} onChange={(event) => setEventType(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none">
              <option>Σεμινάριο</option>
              <option>Βιωματικό εργαστήριο</option>
              <option>Ημερίδα</option>
              <option>Ομαδική θεραπεία</option>
              <option>Συνάντηση</option>
              <option>Άλλη δράση</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="event-mode">Μορφή</label>
            <select id="event-mode" value={mode} onChange={(event) => setMode(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none">
              <option>Διαδικτυακά</option>
              <option>Δια ζώσης</option>
              <option>Διαδικτυακά & δια ζώσης</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <label className="mb-1.5 block text-sm font-semibold text-emerald-950" htmlFor="cover-file">
            Κύρια φωτογραφία δράσης
          </label>
          <input
            id="cover-file"
            type="file"
            accept="image/*"
            onChange={(event) => setCoverImageFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm"
          />
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Αυτή θα εμφανίζεται στην κάρτα και στην κορυφή του «Δείτε περισσότερα».
          </p>

          <label className="mb-1.5 mt-4 block text-sm font-medium" htmlFor="image-url">
            Ή URL κύριας εικόνας <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="image-url"
            type="url"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-emerald-100 bg-white p-4">
          <label className="mb-1.5 block text-sm font-semibold text-emerald-950" htmlFor="detail-file">
            Δεύτερη φωτογραφία
          </label>
          <input
            id="detail-file"
            type="file"
            accept="image/*"
            onChange={(event) => setDetailImageFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          />
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Θα εμφανίζεται μέσα στην αναλυτική παρουσίαση της δράσης.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="long-description">
            Αναλυτική περιγραφή <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <textarea
            id="long-description"
            rows={7}
            value={longDescription}
            onChange={(event) => setLongDescription(event.target.value)}
            placeholder="Γράψε το πλήρες κείμενο της δράσης όπως θέλεις να εμφανίζεται στο «Δείτε περισσότερα»."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="audience">
            Σε ποιους απευθύνεται <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <textarea
            id="audience"
            rows={3}
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="π.χ. επαγγελματίες ψυχικής υγείας, εκπαιδευόμενοι, ευρύ κοινό..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="program-details">
            Πρόγραμμα / θεματικές ενότητες <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <textarea
            id="program-details"
            rows={4}
            value={programDetails}
            onChange={(event) => setProgramDetails(event.target.value)}
            placeholder="Γράψε τις βασικές θεματικές, το πρόγραμμα ή τα σημεία που θα δουλευτούν."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/45 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => {
                setIsPublic(event.target.checked);
                if (!event.target.checked) {
                  setOffersMemberDiscount(false);
                  setMemberPrice("");
                }
              }}
              className="mt-1 h-4 w-4 accent-emerald-600"
            />
            <span>
              <strong className="block text-sm text-emerald-950">Εμφάνιση στο Ημερολόγιο του Συλλόγου</strong>
              <span className="mt-1 block text-xs leading-5 text-slate-600">
                {manageRole === "admin"
                  ? "Ως διαχειριστής, η δράση δημοσιεύεται άμεσα."
                  : "Το αίτημα θα σταλεί με email στο Διοικητικό για έγκριση. Η δράση θα εμφανιστεί δημόσια μόνο μετά την έγκριση."}
              </span>
            </span>
          </label>

          {isPublic && activityCategory !== "association_free" && (
            <div className="mt-4 border-t border-emerald-200 pt-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={offersMemberDiscount}
                  onChange={(event) => {
                    setOffersMemberDiscount(event.target.checked);
                    if (!event.target.checked) setMemberPrice("");
                  }}
                  className="mt-1 h-4 w-4 accent-emerald-600"
                />
                <span className="text-sm font-semibold text-emerald-950">
                  Διατίθεμαι να κάνω ειδική τιμή για Μέλη και Φίλους του Συλλόγου
                </span>
              </label>

              {offersMemberDiscount && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="member-price">
                    Ειδική τιμή Μελών / Φίλων (€)
                  </label>
                  <input
                    id="member-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={memberPrice}
                    onChange={(event) => setMemberPrice(event.target.value)}
                    placeholder="π.χ. 20"
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>

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
  registrationCount,
  canViewRegistrationDetails,
  onViewRegistrations,
  onClose,
  onEdit,
  canApprove,
  onApproved,
  onEmailStatus,
  onDeleted,
}: {
  booking: Booking;
  canManage: boolean;
  registrationCount: number;
  canViewRegistrationDetails: boolean;
  onViewRegistrations: () => void;
  onClose: () => void;
  onEdit: () => void;
  canApprove: boolean;
  onApproved: (booking: Booking) => void;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setApproving(true);
    setError(null);

    try {
      const response = await fetch("/api/approve-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: getManageCode(),
          eventId: booking.booking_date,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error("APPROVAL_FAILED"), {
          code: payload.code || `HTTP_${response.status}`,
        });
      }

      onApproved({
        ...booking,
        requested_public: true,
        approval_status: "approved",
        is_public: true,
      });
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;
      setError(`Δεν ήταν δυνατή η έγκριση${code ? ` (${code})` : ""}.`);
    } finally {
      setApproving(false);
    }
  }

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
        <DetailRow label="Συντονιστές" value={coordinatorsLabel(booking)} />
        <DetailRow label="Ώρα" value={booking.action_time} />
        <DetailRow label="Θέμα" value={booking.topic} />
        <DetailRow label="Περιγραφή" value={booking.description} />
        <DetailRow label="Κατηγορία" value={activityCategoryLabel(booking)} />
        <DetailRow label="Γενική τιμή" value={activityPriceLabel(booking)} />
        {booking.offers_member_discount && (
          <DetailRow label="Τιμή Μελών / Φίλων" value={booking.member_price ? `${booking.member_price} €` : null} />
        )}
        {!isCompleted && (
          <DetailRow
            label="Δημόσιο πρόγραμμα"
            value={
              booking.approval_status === "pending"
                ? "Αναμονή έγκρισης"
                : booking.is_public ? "Εμφανίζεται δημόσια" : "Δεν εμφανίζεται δημόσια"
            }
          />
        )}
      </dl>

      {booking.is_public && canViewRegistrationDetails && (
        <button
          type="button"
          onClick={onViewRegistrations}
          className="mt-5 flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm font-semibold text-sky-950 hover:bg-sky-100"
        >
          <span>Προβολή στοιχείων συμμετεχόντων</span>
          <span className="rounded-full bg-sky-700 px-2.5 py-1 text-xs text-white">{registrationCount}</span>
        </button>
      )}

      {booking.is_public && !canViewRegistrationDetails && (
        <div className="mt-5 flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <span>Συνολικές συμμετοχές</span>
          <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-xs text-white">{registrationCount}</span>
        </div>
      )}

      {isCompleted && (
        <p className="mt-5 rounded-lg bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900">
          Αυτή η δράση έχει ήδη πραγματοποιηθεί και εμφανίζεται μόνο ως ιστορική καταγραφή.
        </p>
      )}

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {canApprove && !isCompleted && (
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={approving || deleting}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {approving ? "Έγκριση…" : "Έγκριση & δημοσίευση"}
          </button>
        )}

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

function RegistrationsModal({
  booking,
  onClose,
  onCountChange,
}: {
  booking: Booking;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadRegistrations() {
    setLoading(true);
    setError(null);
    try {
      const code = getManageCode();
      const response = await fetch(`/api/event-registrations?eventId=${encodeURIComponent(booking.booking_date)}&code=${encodeURIComponent(code)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error("LOAD_FAILED"), { code: payload.code || `HTTP_${response.status}` });
      const items = Array.isArray(payload.registrations) ? payload.registrations : [];
      setRegistrations(items);
      onCountChange(items.length);
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;
      setError(`Δεν ήταν δυνατή η φόρτωση των συμμετοχών${code ? ` (${code})` : ""}.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRegistrations();
  }, [booking.booking_date]);

  async function deleteRegistration(registration: EventRegistration) {
    if (!window.confirm(`Να διαγραφεί η συμμετοχή του/της ${registration.full_name};`)) return;
    setDeletingId(registration.id);
    setError(null);
    try {
      const response = await fetch("/api/event-registrations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: getManageCode(), registrationId: registration.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error("DELETE_FAILED"), { code: payload.code || `HTTP_${response.status}` });
      const next = registrations.filter((item) => item.id !== registration.id);
      setRegistrations(next);
      onCountChange(next.length);
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;
      setError(`Δεν ήταν δυνατή η διαγραφή${code ? ` (${code})` : ""}.`);
    } finally {
      setDeletingId(null);
    }
  }

  function exportCsv() {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ["Ονοματεπώνυμο", "Email", "Τηλέφωνο", "Επάγγελμα", "Σχέση με Σύλλογο", "Σχόλιο", "Ημερομηνία υποβολής"],
      ...registrations.map((item) => [
        item.full_name,
        item.email,
        item.phone,
        item.profession,
        item.membership_status,
        item.comment,
        item.created_at ? new Date(item.created_at).toLocaleString("el-GR") : "",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => quote(String(cell ?? ""))).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `symmetoxes-${booking.booking_date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal onClose={deletingId ? undefined : onClose} wide>
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Συγκεντρωτική λίστα</p>
          <h3 className="mt-1 text-xl font-semibold">{booking.topic || "Δράση Συλλόγου"}</h3>
          <p className="mt-1 text-sm capitalize text-slate-600">{formatDateGreek(booking.booking_date)} · {registrations.length} συμμετοχές</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={loading || registrations.length === 0} className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
          Εξαγωγή CSV
        </button>
      </div>

      {loading && <p className="py-8 text-center text-sm text-slate-500">Φόρτωση συμμετοχών…</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      {!loading && registrations.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-slate-500">Δεν υπάρχουν ακόμη δηλώσεις συμμετοχής για αυτή τη δράση.</p>
      )}

      {!loading && registrations.length > 0 && (
        <div className="mt-4 space-y-3">
          {registrations.map((registration, index) => (
            <article key={registration.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400">#{index + 1}</p>
                  <h4 className="mt-1 font-semibold text-slate-900">{registration.full_name}</h4>
                  <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2 sm:gap-x-6">
                    <p><strong>Email:</strong> <a href={`mailto:${registration.email}`} className="break-all text-sky-700 underline">{registration.email}</a></p>
                    <p><strong>Τηλέφωνο:</strong> <a href={`tel:${registration.phone}`} className="text-sky-700 underline">{registration.phone}</a></p>
                    <p><strong>Επάγγελμα:</strong> {registration.profession}</p>
                    <p><strong>Σχέση με Σύλλογο:</strong> {registration.membership_status || "—"}</p>
                    <p><strong>Υποβολή:</strong> {registration.created_at ? new Date(registration.created_at).toLocaleString("el-GR") : "—"}</p>
                  </div>
                  {registration.comment && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-600"><strong>Σχόλιο:</strong> {registration.comment}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void deleteRegistration(registration)}
                  disabled={deletingId === registration.id}
                  className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {deletingId === registration.id ? "Διαγραφή…" : "Διαγραφή"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} disabled={Boolean(deletingId)} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">Κλείσιμο</button>
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

function Modal({ children, onClose, wide = false }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-2 sm:items-center sm:p-4"
      onClick={() => onClose?.()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`my-2 max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:my-auto sm:max-h-[calc(100vh-2rem)] sm:p-6 ${wide ? "max-w-5xl" : "max-w-lg"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
