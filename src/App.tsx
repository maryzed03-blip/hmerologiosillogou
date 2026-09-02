import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type FirestoreError,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { associationDb, db, ensureAnonymousUser, ensureAssociationAnonymousUser } from "./firebase";

type BookingStatus = "booked" | "completed";
type ActivityCategory = "association" | "association_free" | "therapist_action";
type ApprovalStatus = "draft" | "pending" | "approved";

type Booking = {
  id: string;
  booking_date: string;
  therapist_name: string;
  therapist_role: string | null;
  therapist_email?: string | null;
  additional_coordinator_name: string | null;
  additional_coordinator_role: string | null;
  third_coordinator_name?: string | null;
  third_coordinator_role?: string | null;
  fourth_coordinator_name?: string | null;
  fourth_coordinator_role?: string | null;
  coordinator_photo_url: string | null;
  additional_coordinator_photo_url: string | null;
  third_coordinator_photo_url?: string | null;
  fourth_coordinator_photo_url?: string | null;
  action_time: string | null;
  topic: string | null;
  description: string | null;
  event_type: string | null;
  mode: string | null;
  location?: string | null;
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
  owner_name?: string | null;
  status: BookingStatus;
  is_public: boolean;
};

type TherapistDirectoryItem = {
  id: string;
  name: string;
  photo: string | null;
  city: string | null;
  profession: string | null;
  email?: string | null;
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


const RICH_TEXT_EMOJIS = ["✨", "📌", "✅", "💬", "🌿", "🧠", "❤️", "🎯", "📅", "🙌"];
const RICH_TEXT_COLORS = ["#174B49", "#008D8B", "#8B5E3C", "#7C3AED", "#B91C1C", "#111827"];

function escapeRichText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function plainTextToRichHtml(value: string) {
  return escapeRichText(value).replace(/\r?\n/g, "<br>");
}

function isSafeTextColor(value: string) {
  return /^(#[0-9a-f]{3,8}|rgb(a)?\([0-9.,%\s]+\)|[a-z]+)$/i.test(value.trim());
}

function isSafeFontSize(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^(\d+(?:\.\d+)?)(px|rem|em|%)$/.test(normalized)) return false;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= (normalized.endsWith("px") ? 72 : normalized.endsWith("%") ? 300 : 4);
}

const RICH_FONT_SIZE_MAP: Record<string, string> = {
  "1": "0.75rem",
  "2": "0.875rem",
  "3": "1rem",
  "4": "1.15rem",
  "5": "1.35rem",
  "6": "1.65rem",
  "7": "2rem",
};

function sanitizeRichHtml(value: string) {
  const prepared = looksLikeHtml(value) ? value : plainTextToRichHtml(value);
  if (!prepared.trim()) return "";
  if (typeof DOMParser === "undefined") return prepared;

  const documentValue = new DOMParser().parseFromString(`<div id="sepsyg-rich-root">${prepared}</div>`, "text/html");
  const root = documentValue.getElementById("sepsyg-rich-root");
  if (!root) return plainTextToRichHtml(value);

  const allowed = new Set(["B", "STRONG", "U", "EM", "I", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI", "FONT"]);

  function cleanNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeRichText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    const children = Array.from(element.childNodes).map(cleanNode).join("");

    if (!allowed.has(tag)) return children;
    if (tag === "BR") return "<br>";

    if (tag === "FONT") {
      const color = element.getAttribute("color") ?? "";
      const size = element.getAttribute("size") ?? "";
      const styles: string[] = [];
      if (color && isSafeTextColor(color)) styles.push(`color:${escapeRichText(color)}`);
      if (size && RICH_FONT_SIZE_MAP[size]) styles.push(`font-size:${RICH_FONT_SIZE_MAP[size]}`);
      return styles.length ? `<span style="${styles.join(";")}">${children}</span>` : children;
    }

    if (tag === "SPAN") {
      const color = element.style.color;
      const fontSize = element.style.fontSize;
      const styles: string[] = [];
      if (color && isSafeTextColor(color)) styles.push(`color:${escapeRichText(color)}`);
      if (fontSize && isSafeFontSize(fontSize)) styles.push(`font-size:${escapeRichText(fontSize)}`);
      return styles.length ? `<span style="${styles.join(";")}">${children}</span>` : `<span>${children}</span>`;
    }

    const safeTag = tag.toLowerCase();
    return `<${safeTag}>${children}</${safeTag}>`;
  }

  return Array.from(root.childNodes).map(cleanNode).join("");
}

function richTextForDisplay(value: string | null | undefined) {
  if (!value) return "";
  return sanitizeRichHtml(value);
}

function richTextToPlainText(value: string | null | undefined) {
  if (!value) return "";
  if (typeof DOMParser === "undefined") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const documentValue = new DOMParser().parseFromString(richTextForDisplay(value), "text/html");
  return (documentValue.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function RichTextDisplay({ value, className = "" }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  return <div className={`sepsyg-rich-output ${className}`} dangerouslySetInnerHTML={{ __html: richTextForDisplay(value) }} />;
}

function RichTextEditor({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    selectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const editor = editorRef.current;
    const saved = selectionRef.current;
    const selection = window.getSelection();
    if (!editor || !saved || !selection) return;
    editor.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(saved);
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = richTextForDisplay(value);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
  }, [value, disabled]);

  function emitValue() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(sanitizeRichHtml(editor.innerHTML));
  }

  function runCommand(command: string, argument?: string) {
    if (disabled) return;
    restoreSelection();
    const editor = editorRef.current;
    if (!editor) return;
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, argument);
    emitValue();
    rememberSelection();
  }

  function applyBold() {
    if (disabled) return;
    restoreSelection();
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    // Robust bold: do not depend only on deprecated execCommand("bold"),
    // which behaves inconsistently inside contentEditable on some browsers.
    if (!selection.isCollapsed) {
      try {
        const wrapper = document.createElement("strong");
        wrapper.setAttribute("data-sepsyg-bold", "1");
        const fragment = range.extractContents();
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);

        const nextRange = document.createRange();
        nextRange.selectNodeContents(wrapper);
        selection.removeAllRanges();
        selection.addRange(nextRange);
        selectionRef.current = nextRange.cloneRange();
        emitValue();
        return;
      } catch {
        // Fallback below for complex selections that cannot be wrapped directly.
      }
    }

    document.execCommand("bold", false);
    emitValue();
    rememberSelection();
  }

  function uppercaseSelection() {
    if (disabled) return;
    restoreSelection();
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || selection.isCollapsed) return;
    const selected = selection.toString();
    document.execCommand("insertText", false, selected.toLocaleUpperCase("el-GR"));
    emitValue();
  }

  return (
    <div className={`sepsyg-rich-editor ${disabled ? "is-disabled" : ""}`}>
      <div className="sepsyg-rich-controls">
      <div className="sepsyg-rich-toolbar" aria-label="Εργαλεία μορφοποίησης">
        <button type="button" title="Έντονα" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={applyBold}><strong>B</strong></button>
        <button type="button" title="Υπογράμμιση" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("underline")}><u>U</u></button>
        <button type="button" title="Μετατροπή του επιλεγμένου κειμένου σε κεφαλαία" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={uppercaseSelection}>ΑΑ</button>
        <span className="sepsyg-rich-toolbar-separator" />
        <button type="button" title="Μικρότερα γράμματα" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("fontSize", "2")}>A−</button>
        <button type="button" title="Κανονικό μέγεθος" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("fontSize", "3")}>A</button>
        <button type="button" title="Μεγαλύτερα γράμματα" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("fontSize", "5")}>A+</button>
        <button type="button" title="Πολύ μεγάλα γράμματα" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("fontSize", "6")}>A++</button>
        <span className="sepsyg-rich-toolbar-separator" />
        {RICH_TEXT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="sepsyg-rich-color"
            title={`Χρώμα ${color}`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand("foreColor", color)}
          >
            <span style={{ backgroundColor: color }} />
          </button>
        ))}
      </div>
      <div className="sepsyg-rich-emoji-row" aria-label="Έτοιμα emoji">
        {RICH_TEXT_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertText", emoji)}>{emoji}</button>
        ))}
      </div>
      </div>
      <div
        id={id}
        ref={editorRef}
        className="sepsyg-rich-editor-area"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Γράψε εδώ…"}
        onInput={() => {
          const editor = editorRef.current;
          if (editor) onChange(editor.innerHTML);
          rememberSelection();
        }}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onFocus={rememberSelection}
        onSelect={rememberSelection}
        onBlur={() => {
          rememberSelection();
          emitValue();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emitValue();
        }}
      />
    </div>
  );
}

const STATIC_BOOKINGS: Booking[] = [
  {
    id: "2026-07-05",
    booking_date: "2026-07-05",
    therapist_name: "Ευαγγελία Ξανθοπούλου",
    therapist_role: "Κλινική Κοινωνική Λειτουργός · Συστημική Θεραπεία · Σ.Ε.ΨΥ.G.",
    additional_coordinator_name: "Μαρία Ζάχου",
    additional_coordinator_role: "Τελειόφοιτη Σύμβουλος Ψυχικής Υγείας Σ.Ε.ΨΥ.G.",
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
  {
    id: "2026-07-19",
    booking_date: "2026-07-19",
    therapist_name: "",
    therapist_role: null,
    additional_coordinator_name: null,
    additional_coordinator_role: null,
    coordinator_photo_url: null,
    additional_coordinator_photo_url: null,
    action_time: "11:00 – 20:00",
    topic: "Καλοκαιρινή Διατροφή και Εικόνα Σώματος",
    description: "Εξειδικευμένη Ημερίδα Διατροφικών Διαταραχών και Σ.Ε.ΨΥ.G. για τη σχέση με το φαγητό, το σώμα, την εικόνα σώματος και τη σωματικά επικεντρωμένη θεραπευτική προσέγγιση.",
    event_type: "Ημερίδα",
    mode: "Διαδικτυακά μέσω Zoom",
    image_url: "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194156.png",
    detail_image_url: null,
    long_description: "Μια ημερίδα αφιερωμένη στη σχέση με το φαγητό και το σώμα, στην πίεση του “summer body”, στις διατροφικές διαταραχές, στην εικόνα σώματος και στη θεραπευτική κατανόηση μέσα από τη Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt και άλλες συμπληρωματικές οπτικές.",
    audience: "Επαγγελματίες και εκπαιδευόμενοι ψυχικής υγείας, ψυχοθεραπείας, ψυχολογίας, διατροφής και διατροφικών διαταραχών, καθώς και άνθρωποι που θέλουν να κατανοήσουν βαθύτερα τη σχέση σώματος, φαγητού και ψυχικής υγείας.",
    program_details: "Ομιλίες, σεμινάρια και βιωματικό εργαστήρι από τις 11:00 έως τις 20:00.",
    activity_category: "association",
    general_price: "15",
    offers_member_discount: false,
    member_price: null,
    requested_public: true,
    approval_status: "approved",
    owner_uid: "static-completed-event",
    status: "completed",
    is_public: true,
  },
  {
    id: "2026-02-28",
    booking_date: "2026-02-28",
    therapist_name: "",
    therapist_role: null,
    additional_coordinator_name: null,
    additional_coordinator_role: null,
    coordinator_photo_url: null,
    additional_coordinator_photo_url: null,
    action_time: null,
    topic: "Γνωρίστε την Ομαδική Ψυχοθεραπεία",
    description: "Με Σωματική Επικέντρωση σε πόλεις της Ελλάδας και της Κύπρου.",
    event_type: "Ομαδική Ψυχοθεραπεία",
    mode: "Διαδικτυακά & δια ζώσης",
    image_url: "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194048.png",
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

const MONTHS = buildMonths(2026, 1, 2027, 7); // Φεβρουάριος 2026 έως Αύγουστος 2027

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
    therapist_role:
      typeof data.therapist_role === "string" && data.therapist_role.trim()
        ? data.therapist_role.trim()
        : null,
    therapist_email:
      typeof data.therapist_email === "string" && data.therapist_email.trim()
        ? data.therapist_email.trim()
        : null,
    additional_coordinator_name:
      typeof data.additional_coordinator_name === "string" && data.additional_coordinator_name.trim()
        ? data.additional_coordinator_name.trim()
        : null,
    additional_coordinator_role:
      typeof data.additional_coordinator_role === "string" && data.additional_coordinator_role.trim()
        ? data.additional_coordinator_role.trim()
        : null,
    third_coordinator_name:
      typeof data.third_coordinator_name === "string" && data.third_coordinator_name.trim()
        ? data.third_coordinator_name.trim()
        : null,
    third_coordinator_role:
      typeof data.third_coordinator_role === "string" && data.third_coordinator_role.trim()
        ? data.third_coordinator_role.trim()
        : null,
    fourth_coordinator_name:
      typeof data.fourth_coordinator_name === "string" && data.fourth_coordinator_name.trim()
        ? data.fourth_coordinator_name.trim()
        : null,
    fourth_coordinator_role:
      typeof data.fourth_coordinator_role === "string" && data.fourth_coordinator_role.trim()
        ? data.fourth_coordinator_role.trim()
        : null,
    coordinator_photo_url:
      typeof data.coordinator_photo_url === "string" && data.coordinator_photo_url.trim()
        ? data.coordinator_photo_url
        : null,
    additional_coordinator_photo_url:
      typeof data.additional_coordinator_photo_url === "string" && data.additional_coordinator_photo_url.trim()
        ? data.additional_coordinator_photo_url
        : null,
    third_coordinator_photo_url:
      typeof data.third_coordinator_photo_url === "string" && data.third_coordinator_photo_url.trim()
        ? data.third_coordinator_photo_url
        : null,
    fourth_coordinator_photo_url:
      typeof data.fourth_coordinator_photo_url === "string" && data.fourth_coordinator_photo_url.trim()
        ? data.fourth_coordinator_photo_url
        : null,
    action_time: typeof data.action_time === "string" ? data.action_time : null,
    topic: typeof data.topic === "string" ? data.topic : null,
    description: typeof data.description === "string" ? data.description : null,
    event_type: typeof data.event_type === "string" ? data.event_type : null,
    mode: typeof data.mode === "string" ? data.mode : null,
    location: typeof data.location === "string" && data.location.trim() ? data.location.trim() : null,
    image_url: typeof data.image_url === "string" ? data.image_url : null,
    detail_image_url: typeof data.detail_image_url === "string" ? data.detail_image_url : null,
    long_description: typeof data.long_description === "string" ? data.long_description : null,
    audience: typeof data.audience === "string" ? data.audience : null,
    program_details: typeof data.program_details === "string" ? data.program_details : null,
    activity_category:
      data.activity_category === "association_free" ? "association_free" : (data.activity_category === "therapist_action" || data.activity_category === "therapist_independent") ? "therapist_action" : "association",
    general_price: typeof data.general_price === "string" ? data.general_price : null,
    offers_member_discount: data.offers_member_discount === true,
    member_price: typeof data.member_price === "string" ? data.member_price : null,
    requested_public: data.requested_public === true || data.is_public === true,
    approval_status:
      data.approval_status === "pending" || data.approval_status === "draft"
        ? data.approval_status
        : data.is_public === true ? "approved" : "draft",
    owner_uid: String(data.owner_uid ?? ""),
    owner_name: typeof data.owner_name === "string" && data.owner_name.trim() ? data.owner_name.trim() : null,
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

function bookingOwnedByMember(booking: Booking, memberName: string) {
  const target = normalizeTherapistName(memberName);
  if (!target) return false;
  const explicitOwner = normalizeTherapistName(booking.owner_name);
  if (explicitOwner) return explicitOwner === target;
  return [
    booking.therapist_name,
    booking.additional_coordinator_name,
    booking.third_coordinator_name,
    booking.fourth_coordinator_name,
  ].some((person) => normalizeTherapistName(person) === target);
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
          profession: stringField("profession") ?? stringField("role"),
          email: stringField("email"),
        };
      })
      .filter((item: TherapistDirectoryItem) => Boolean(item.name));
  } catch {
    return [];
  }
}

function coordinatorsLabel(booking: Booking) {
  return [
    booking.therapist_name,
    booking.additional_coordinator_name,
    booking.third_coordinator_name,
    booking.fourth_coordinator_name,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" & ");
}

function activityCategoryLabel(booking: Booking) {
  if (booking.activity_category === "association_free") return "Δωρεάν Δράση Συλλόγου";
  if (booking.activity_category === "therapist_action") return "Δράση Θεραπευτή Συλλόγου";
  return "Δράση Συλλόγου";
}

function activityCategoryClass(booking: Booking) {
  if (booking.activity_category === "association_free") return "category-free";
  if (booking.activity_category === "therapist_action") return "category-independent";
  return "category-association";
}

function activityCategoryUnderline(booking: Booking) {
  if (booking.activity_category === "association_free") return "inset 0 -5px 0 #63A97E";
  if (booking.activity_category === "therapist_action") return "inset 0 -5px 0 #79B9D3";
  return "inset 0 -5px 0 #E39A55";
}

function activityPriceLabel(booking: Booking) {
  const customPrice = booking.general_price?.trim();
  if (customPrice) return customPrice;
  if (booking.activity_category === "association_free") return "Δωρεάν";
  return "";
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
        third_coordinator_name: booking.third_coordinator_name ?? null,
        fourth_coordinator_name: booking.fourth_coordinator_name ?? null,
        action_time: booking.action_time,
        location: booking.location ?? null,
        topic: booking.topic,
        description: richTextToPlainText(booking.description),
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
const PORTAL_NAME_KEY = "association-portal-name";
const PORTAL_REMEMBER_KEY = "association-portal-remember";
type ManageRole = "member" | "admin";

function shouldRememberPortal() {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(PORTAL_REMEMBER_KEY) === "1"; } catch { return false; }
}

function getManageCode() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(MANAGE_ACCESS_KEY)
      || (shouldRememberPortal() ? window.localStorage.getItem(MANAGE_ACCESS_KEY) || "" : "");
  } catch { return ""; }
}

function getManageRole(): ManageRole | null {
  if (typeof window === "undefined") return null;
  try {
    const role = window.sessionStorage.getItem(MANAGE_ROLE_KEY)
      || (shouldRememberPortal() ? window.localStorage.getItem(MANAGE_ROLE_KEY) : null);
    return role === "admin" || role === "member" ? role : null;
  } catch { return null; }
}

function getPortalName() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(PORTAL_NAME_KEY)
      || (shouldRememberPortal() ? window.localStorage.getItem(PORTAL_NAME_KEY) || "" : "");
  } catch { return ""; }
}

function readLocalDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ value, saved_at: new Date().toISOString() }));
  } catch {
    // Local drafts are a safety net. A storage failure must never block editing.
  }
}

function readLocalDraftValue<T>(key: string): T | null {
  const wrapped = readLocalDraft<{ value?: T }>(key);
  return wrapped?.value ?? null;
}

function clearLocalDraft(key: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

function articlePublicUrl(articleId: string) {
  if (typeof window === "undefined" || !articleId) return "";
  return `${window.location.origin}/article/${encodeURIComponent(articleId)}`;
}

function eventPublicUrl(eventDate: string) {
  if (typeof window === "undefined" || !eventDate) return "";
  return `${window.location.origin}/events?event=${encodeURIComponent(eventDate)}`;
}

type BoardTermAdmin = {
  id: string;
  from_year: number;
  to_year: number;
  president: string;
  vice_president: string;
  secretary: string;
  treasurer: string;
  member: string;
  hidden?: boolean;
  isStatic?: boolean;
};

type CommunityKind = "member" | "friend";
type CommunityPersonAdmin = {
  id: string;
  name: string;
  type: CommunityKind;
  source: "static" | "remote";
};

const STATIC_BOARD_TERMS: BoardTermAdmin[] = [
  {
    id: "static-2026-2028",
    from_year: 2026,
    to_year: 2028,
    president: "Στέφανος Γκιουλτζόγλου",
    vice_president: "Μανουσάκιε Μπαλλχύσα Τσάκα",
    secretary: "Μαρία Ζάχου",
    treasurer: "Ταξιάρχης Πάζιος",
    member: "Ευαγγελία Ξανθοπούλου",
    isStatic: true,
  },
  {
    id: "static-2023-2026",
    from_year: 2023,
    to_year: 2026,
    president: "Μαρία Κουτσοκώστα",
    vice_president: "Στέφανος Γκιουλτζόγλου",
    secretary: "Ειρήνη Νταλάρα",
    treasurer: "Γωγώ Παπαγεωργίου",
    member: "Ταξιάρχης Πάζιος",
    isStatic: true,
  },
];

const STATIC_ASSOCIATION_MEMBERS = [
  "Αγγελόπουλος Περικλής",
  "Αμανάκης Μάνος",
  "Ανδρικοπούλου Έλενα",
  "Βογιατζή Φραντζέσκα",
  "Γκιουλτζούογλου Στέφανος",
  "Διβανόγλου Σταυρούλα",
  "Ζάγκα Δήμητρα",
  "Ζάχου Μαρία",
  "Ισάκοφ Σέργιος",
  "Κοζυράκη Σοφία",
  "Κουτσοκώστα Μαρία",
  "Κρεμμύδα Μαρία",
  "Λάζαρης Στάθης",
  "Μελά Βίβιαν",
  "Μπαλχύσσα Τσάκα Μανουσακιε",
  "Νεστοράκη Δέσποινα",
  "Νταλαρά Ειρήνη",
  "Ξανθοπούλου Ευαγγελία",
  "Παζιος Ταξιάρχης",
  "Παπαγεωργίου Γωγώ",
  "Πλατανησιώτη Σοφία",
  "Προκοπίου Κατερίνα",
  "Σαατσάκη Ευνίκη",
  "Σαμαρά Γεωργία",
  "Σέργη Βίβιαν",
  "Σιδηροπούλου Σοφία",
  "Τσουλκανίδου Τζούλια",
  "Φραντζή Κυριακή",
  "Χαραλάμπους Μαίρη",
  "Χατζηαναστασίου Κωνσταντίνα",
  "Ψυχογίος Κλέαρχος",
];

function normalizeCommunityName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el")
    .replace(/\s+/g, " ")
    .trim();
}

function communityControlId(name: string, kind: CommunityKind) {
  const encoded = Array.from(normalizeCommunityName(name))
    .map((char) => char.codePointAt(0)?.toString(36) || "0")
    .join("-")
    .slice(0, 380);
  return `control-${kind}-${encoded}`;
}


type WebsiteFieldKind = "text" | "textarea" | "url" | "image" | "color" | "select";

type WebsiteFieldDefinition = {
  key: string;
  label: string;
  kind: WebsiteFieldKind;
  placeholder?: string;
  help?: string;
  group?: "content" | "appearance";
  options?: Array<{ value: string; label: string }>;
};

type WebsiteSectionDefinition = {
  key: string;
  label: string;
  description: string;
  connected: boolean;
  fields: WebsiteFieldDefinition[];
  defaults: Record<string, string>;
};

type SiteContentAdminSection = {
  id: string;
  section_key: string;
  label: string;
  draft: Record<string, string>;
  published: Record<string, string>;
  updated_at: string | null;
  published_at: string | null;
  updated_by: string;
};

type SiteContentVersion = {
  id: string;
  section_key: string;
  label: string;
  fields: Record<string, string>;
  created_at: string | null;
  created_by: string;
  action: string;
};

const WEBSITE_FONT_OPTIONS = [
  { value: "Georgia, \"Times New Roman\", serif", label: "Georgia / Times New Roman" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial / Helvetica" },
  { value: "Verdana, Arial, sans-serif", label: "Verdana" },
  { value: "\"Trebuchet MS\", Arial, sans-serif", label: "Trebuchet MS" },
];

const WEBSITE_SECTION_DEFINITIONS: WebsiteSectionDefinition[] = [
  {
    key: "general",
    label: "Γενικά στοιχεία & Logo",
    description: "Κεντρικές πληροφορίες που χρησιμοποιούνται σε header, hero, επικοινωνία και footer. Αλλάζοντάς τες εδώ ενημερώνονται τα συνδεδεμένα blocks.",
    connected: true,
    fields: [
      { key: "logo_url", label: "Logo Συλλόγου", kind: "image" },
      { key: "short_name", label: "Σύντομη ονομασία", kind: "text" },
      { key: "full_name", label: "Πλήρης ονομασία", kind: "textarea" },
      { key: "approach_name", label: "Ονομασία προσέγγισης", kind: "text" },
      { key: "email", label: "Email Συλλόγου", kind: "text" },
      { key: "president_name", label: "Πρόεδρος · Όνομα", kind: "text" },
      { key: "president_role", label: "Πρόεδρος · Ρόλος", kind: "text" },
      { key: "president_phone", label: "Πρόεδρος · Τηλέφωνο", kind: "text" },
      { key: "secretary_name", label: "Γραμματεία · Όνομα", kind: "text" },
      { key: "secretary_role", label: "Γραμματεία · Ρόλος", kind: "text" },
      { key: "secretary_phone", label: "Γραμματεία · Τηλέφωνο", kind: "text" },
      { key: "address", label: "Διεύθυνση", kind: "textarea" },
      { key: "facebook_url", label: "Facebook URL", kind: "url" },
      { key: "instagram_url", label: "Instagram URL", kind: "url" },
      { key: "public_site_url", label: "Δημόσια ιστοσελίδα", kind: "url" },
    ],
    defaults: {
      "logo_url": "https://demo.unityenergetics.org/wp-content/uploads/2026/07/Στιγμιότυπο-οθόνης-2026-06-27-202314.png",
      "short_name": "Σ.Ε.ΨΥ.G.",
      "full_name": "Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.",
      "approach_name": "Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt",
      "email": "euassociationsepsyg@gmail.com",
      "president_name": "Στέφανος Γκιουλτζόγλου",
      "president_role": "Πρόεδρος",
      "president_phone": "693 796 2301",
      "secretary_name": "Μαρία Ζάχου",
      "secretary_role": "Γραμματέας",
      "secretary_phone": "694 064 5022",
      "address": "Πολυτεχνίου 37\nΘεσσαλονίκη, ΤΚ 54626",
      "facebook_url": "https://www.facebook.com/share/g/17TTMo8AWK/",
      "instagram_url": "",
      "public_site_url": "https://euassociationsepsyg.carrd.co/#",
    },
  },
  {
    key: "hero",
    label: "Hero / Αρχική",
    description: "Το κεντρικό hero της αρχικής σελίδας και η νέα εγγραφή στο newsletter.",
    connected: true,
    fields: [
      { key: "text_01", label: "Κείμενο · Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt", kind: "textarea" },
      { key: "text_02", label: "Τίτλος · Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.", kind: "text" },
      { key: "text_03", label: "Κείμενο · Καλωσορίσατε στον Πανευρωπαϊκό Επιστημονικό Σύλλογο Σ.Ε.ΨΥ.G. Έν…", kind: "textarea" },
      { key: "background_image", label: "Εικόνα φόντου hero", kind: "image" },
      { key: "newsletter_eyebrow", label: "Μικρός τίτλος newsletter", kind: "text" },
      { key: "newsletter_title", label: "Τίτλος newsletter", kind: "text" },
      { key: "newsletter_text", label: "Κείμενο newsletter", kind: "textarea" },
      { key: "newsletter_placeholder", label: "Placeholder email", kind: "text" },
      { key: "newsletter_button", label: "Κείμενο κουμπιού εγγραφής", kind: "text" },
      { key: "newsletter_consent", label: "Κείμενο συγκατάθεσης", kind: "textarea" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt",
      "text_02": "Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.",
      "text_03": "Καλωσορίσατε στον Πανευρωπαϊκό Επιστημονικό Σύλλογο Σ.Ε.ΨΥ.G. Έναν χώρο συνάντησης, θεραπείας και βαθιάς ανθρώπινης επαφής.",
      "background_image": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/γαλαζιο.συλλογος.png",
      "newsletter_eyebrow": "Newsletter",
      "newsletter_title": "Μάθε πρώτος για όλες τις δράσεις",
      "newsletter_text": "Γράψε το email σου και θα λαμβάνεις ενημέρωση για νέες δράσεις, σεμινάρια και ανακοινώσεις του Συλλόγου.",
      "newsletter_placeholder": "Το email σου",
      "newsletter_button": "Εγγραφή",
      "newsletter_consent": "Συμφωνώ να χρησιμοποιηθεί το email μου αποκλειστικά για ενημερώσεις του Συλλόγου.",
      "style_section_background": "#008D8B",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#FFFFFF",
      "style_body_color": "#FFFFFF",
      "style_accent_color": "#F3CFB0",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(38px, 4.4vw, 60px)",
      "style_body_size": "clamp(16px, 1.35vw, 20px)",
      "style_line_height": "1.65",
      "style_section_padding": "44px 28px 60px",
      "style_card_radius": "0px",
      "style_card_shadow": "none",
      "style_image_position": "center",
    },
  },
  {
    key: "home_intro",
    label: "Ο Σύλλογος με μια ματιά",
    description: "Οι δύο εισαγωγικές κάρτες της αρχικής.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Γνωρίστε μας", kind: "text" },
      { key: "text_02", label: "Τίτλος · Ο Σύλλογος με μια ματιά", kind: "text" },
      { key: "text_03", label: "Ετικέτα · Το όραμά μας", kind: "text" },
      { key: "text_04", label: "Ετικέτα · Το όραμά μας", kind: "text" },
      { key: "text_05", label: "Τίτλος · Ένας χώρος επαφής, παρουσίας και εξέλιξης", kind: "text" },
      { key: "text_06", label: "Κείμενο · Γνωρίστε τις αξίες, τον σκοπό και την κατεύθυνση του Συλλόγου.", kind: "textarea" },
      { key: "text_07", label: "Κουμπί / σύνδεσμος · Δες περισσότερα", kind: "text" },
      { key: "text_08", label: "Ετικέτα · Η προσέγγιση", kind: "text" },
      { key: "text_09", label: "Ετικέτα · Η προσέγγιση Σ.Ε.ΨΥ.G.", kind: "text" },
      { key: "text_10", label: "Τίτλος · Το σώμα ως ζωντανή πηγή εμπειρίας", kind: "text" },
      { key: "text_11", label: "Κείμενο · Διαβάστε για τη θεωρητική βάση και τη θεραπευτική κατεύθυνση της…", kind: "textarea" },
      { key: "text_12", label: "Κουμπί / σύνδεσμος · Δες περισσότερα", kind: "text" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "image_02", label: "Εικόνα 2", kind: "image" },
      { key: "image_02_alt", label: "Εικόνα 2 · Alt / περιγραφή", kind: "text" },
      { key: "link_01_url", label: "URL · Δες περισσότερα", kind: "url" },
      { key: "link_02_url", label: "URL · Δες περισσότερα", kind: "url" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Γνωρίστε μας",
      "text_02": "Ο Σύλλογος με μια ματιά",
      "text_03": "Το όραμά μας",
      "text_04": "Το όραμά μας",
      "text_05": "Ένας χώρος επαφής, παρουσίας και εξέλιξης",
      "text_06": "Γνωρίστε τις αξίες, τον σκοπό και την κατεύθυνση του Συλλόγου.",
      "text_07": "Δες περισσότερα",
      "text_08": "Η προσέγγιση",
      "text_09": "Η προσέγγιση Σ.Ε.ΨΥ.G.",
      "text_10": "Το σώμα ως ζωντανή πηγή εμπειρίας",
      "text_11": "Διαβάστε για τη θεωρητική βάση και τη θεραπευτική κατεύθυνση της Σ.Ε.ΨΥ.G.",
      "text_12": "Δες περισσότερα",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/vision.jpg",
      "image_01_alt": "Το όραμα του Συλλόγου",
      "image_02": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/11-Benefits-of-Somatic-Therapy-You-Need-to-Know.webp_0d0c5fda-5579-4392-a3de-66727816fda0_11-Benefits-of-Somatic-Therapy-You-Need-to-Know.webp",
      "image_02_alt": "Η προσέγγιση Σ.Ε.ΨΥ.G.",
      "link_01_url": "#vision",
      "link_02_url": "#sepshyg1",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(1.9rem, 3.8vw, 2.75rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.7",
      "style_section_padding": "98px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(0, 109, 105, 0.08)",
      "style_image_position": "center",
    },
  },
  {
    key: "activities_static",
    label: "Δράσεις · Κάρτες αρχικής",
    description: "Οι 3 κάρτες ενημερώνονται αυτόματα από τις δημόσιες δράσεις. Εδώ αλλάζεις μόνο τον τίτλο, το εισαγωγικό κείμενο και την εμφάνιση.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Ημερολόγιο Συλλόγου", kind: "text" },
      { key: "text_02", label: "Τίτλος · Δράσεις", kind: "text" },
      { key: "text_03", label: "Εισαγωγικό κείμενο", kind: "textarea" },
      { key: "text_23", label: "Κουμπί · Δες όλες τις δράσεις", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Ημερολόγιο Συλλόγου",
      "text_02": "Δράσεις",
      "text_03": "Σεμινάρια, βιωματικά εργαστήρια και συναντήσεις που καλλιεργούν την επαφή, την επίγνωση και τη ζωντανή εμπειρία.",
      "text_04": "Ημερίδα",
      "text_05": "Διαδικτυακά",
      "text_06": "Εξειδικευμένη Ημερίδα Διατροφικών Διαταραχών & Σ.Ε.ΨΥ.G.",
      "text_07": "Καλοκαιρινή Διατροφή και Εικόνα Σώματος",
      "text_08": "Κυριακή, 19 Ιουλίου 2026",
      "text_09": "11:00 – 20:00",
      "text_10": "Πληροφορίες",
      "text_11": "Εργαστήριο",
      "text_12": "Διαδικτυακά",
      "text_13": "Βιωματικό Εργαστήριο",
      "text_14": "«Από την Εσωτερική Ησυχία στην Αυθεντική Συνάντηση»",
      "text_15": "5 Ιουλίου 2026",
      "text_16": "Πληροφορίες",
      "text_17": "Ομαδική θεραπεία",
      "text_18": "Διαδικτυακά & δια ζώσης",
      "text_19": "Γνωρίστε την Ομαδική Ψυχοθεραπεία",
      "text_20": "Με Σωματική Επικέντρωση σε πόλεις της Ελλάδας και της Κύπρου",
      "text_21": "28 Φεβρουαρίου 2026",
      "text_22": "Πληροφορίες",
      "text_23": "Δες όλες τις δράσεις",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194156.png",
      "image_01_alt": "Εξειδικευμένη Ημερίδα Διατροφικών Διαταραχών και Σ.Ε.ΨΥ.G.",
      "image_02": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194130.png",
      "image_02_alt": "Βιωματικό Εργαστήριο",
      "image_03": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Στιγμιότυπο-οθόνης-2026-08-06-194048.png",
      "image_03_alt": "Γνωρίστε την Ομαδική Ψυχοθεραπεία",
      "link_01_url": "https://eikonasomatos.heysummit.com/",
      "link_02_url": "https://kalokeriniempiriaaytognosias.carrd.co/",
      "link_03_url": "https://app.vbout.com/unity-energetic/preview/354140/?hash=2c783992eeabd13000994a0a65eca9da",
      "link_04_url": "#activities",
      "style_section_background": "#F4ECE5",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2rem, 4vw, 2.85rem)",
      "style_body_size": "0.92rem",
      "style_line_height": "1.65",
      "style_section_padding": "98px 0 104px",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(0, 109, 105, 0.08)",
      "style_image_position": "center",
    },
  },
  {
    key: "membership_form",
    label: "Φόρμα · Γίνε Μέλος",
    description: "Το κείμενο, οι ετικέτες και η εμφάνιση της φόρμας ενδιαφέροντος.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Έλα στην κοινότητά μας", kind: "text" },
      { key: "text_02", label: "Τίτλος · Θέλεις να γίνεις μέλος;", kind: "text" },
      { key: "text_03", label: "Κείμενο · Συμπλήρωσε τη φόρμα και το αίτημά σου θα σταλεί στο email του Συ…", kind: "textarea" },
      { key: "text_04", label: "Ετικέτα · Θα επικοινωνήσουμε μαζί σου για τα επόμενα βήματα.", kind: "text" },
      { key: "text_05", label: "Φόρμα · Ονοματεπώνυμο *", kind: "text" },
      { key: "text_06", label: "Φόρμα · Email *", kind: "text" },
      { key: "text_07", label: "Φόρμα · Τηλέφωνο", kind: "text" },
      { key: "text_08", label: "Φόρμα · Πόλη / Περιοχή *", kind: "text" },
      { key: "text_09", label: "Φόρμα · Επάγγελμα / Ιδιότητα", kind: "text" },
      { key: "text_10", label: "Φόρμα · Ενδιαφέρομαι να γίνω *", kind: "text" },
      { key: "text_11", label: "Φόρμα · Επίλεξε", kind: "text" },
      { key: "text_12", label: "Φόρμα · Μέλος του Συλλόγου", kind: "text" },
      { key: "text_13", label: "Φόρμα · Φίλος του Συλλόγου", kind: "text" },
      { key: "text_14", label: "Φόρμα · Θέλω πρώτα περισσότερες πληροφορίες", kind: "text" },
      { key: "text_15", label: "Φόρμα · Μήνυμα", kind: "text" },
      { key: "text_16", label: "Ετικέτα · Συμφωνώ να χρησιμοποιηθούν τα στοιχεία μου αποκλειστικά για την …", kind: "text" },
      { key: "text_17", label: "Κουμπί / σύνδεσμος · Αποστολή αιτήματος", kind: "text" },
      { key: "text_18", label: "Κείμενο · Στην πρώτη δοκιμή ενδέχεται να χρειαστεί μία φορά ενεργοποίηση τ…", kind: "textarea" },
      { key: "placeholder_01", label: "Placeholder φόρμας 1", kind: "text" },
      { key: "recipient_email", label: "Email παραλήπτη φόρμας", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Έλα στην κοινότητά μας",
      "text_02": "Θέλεις να γίνεις μέλος;",
      "text_03": "Συμπλήρωσε τη φόρμα και το αίτημά σου θα σταλεί στο email του Συλλόγου.",
      "text_04": "Θα επικοινωνήσουμε μαζί σου για τα επόμενα βήματα.",
      "text_05": "Ονοματεπώνυμο *",
      "text_06": "Email *",
      "text_07": "Τηλέφωνο",
      "text_08": "Πόλη / Περιοχή *",
      "text_09": "Επάγγελμα / Ιδιότητα",
      "text_10": "Ενδιαφέρομαι να γίνω *",
      "text_11": "Επίλεξε",
      "text_12": "Μέλος του Συλλόγου",
      "text_13": "Φίλος του Συλλόγου",
      "text_14": "Θέλω πρώτα περισσότερες πληροφορίες",
      "text_15": "Μήνυμα",
      "text_16": "Συμφωνώ να χρησιμοποιηθούν τα στοιχεία μου αποκλειστικά για την επικοινωνία σχετικά με το αίτημά μου. *",
      "text_17": "Αποστολή αιτήματος",
      "text_18": "Στην πρώτη δοκιμή ενδέχεται να χρειαστεί μία φορά ενεργοποίηση της φόρμας από το email του Συλλόγου.",
      "placeholder_01": "Γράψε προαιρετικά λίγα λόγια για το ενδιαφέρον σου.",
      "recipient_email": "euassociationsepsyg@gmail.com",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#6F7E7B",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DCE4E1",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.5rem,5vw,4.3rem)",
      "style_body_size": "1rem",
      "style_line_height": "1.8",
      "style_section_padding": "90px 0 95px",
      "style_card_radius": "28px",
      "style_card_shadow": "0 20px 55px rgba(37,65,61,.09)",
      "style_image_position": "center",
    },
  },
  {
    key: "vision",
    label: "Όραμα Συλλόγου",
    description: "Η πλήρης ενότητα «Όραμα Συλλόγου».",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Το όραμά μας", kind: "text" },
      { key: "text_02", label: "Τίτλος · Όραμα Συλλόγου", kind: "text" },
      { key: "text_03", label: "Ετικέτα · Σωματική συνείδηση", kind: "text" },
      { key: "text_04", label: "Τίτλος · Το σώμα ως ζωντανή πηγή εμπειρίας", kind: "text" },
      { key: "text_05", label: "Κείμενο · Εδώ τιμούμε το σώμα ως ζωντανή πηγή μνήμης, σοφίας και ζωτικής δ…", kind: "textarea" },
      { key: "text_06", label: "Κείμενο · Πιστεύουμε ότι η θεραπεία δεν αφορά μόνο τη γνωστική κατανόηση τ…", kind: "textarea" },
      { key: "text_07", label: "Ετικέτα · Ο σκοπός μας", kind: "text" },
      { key: "text_08", label: "Τίτλος · Μια κοινότητα ουσιαστικής θεραπείας και εξέλιξης", kind: "text" },
      { key: "text_09", label: "Κείμενο · Η Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt υποστηρίζει το άτο…", kind: "textarea" },
      { key: "text_10", label: "Κείμενο · Ο Σύλλογος δημιουργήθηκε με σκοπό τη διάδοση και την προαγωγή τη…", kind: "textarea" },
      { key: "text_11", label: "Κείμενο · Γιατί η θεραπεία ξεκινά από την επαφή — με το σώμα, με το συναίσ…", kind: "textarea" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "image_02", label: "Εικόνα 2", kind: "image" },
      { key: "image_02_alt", label: "Εικόνα 2 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Το όραμά μας",
      "text_02": "Όραμα Συλλόγου",
      "text_03": "Σωματική συνείδηση",
      "text_04": "Το σώμα ως ζωντανή πηγή εμπειρίας",
      "text_05": "Εδώ τιμούμε το σώμα ως ζωντανή πηγή μνήμης, σοφίας και ζωτικής δύναμης. Το σώμα δεν αποτελεί απλώς το «όχημα» της ύπαρξής μας, αλλά τον τόπο όπου καταγράφονται οι εμπειρίες μας, οι σχέσεις μας, τα τραύματα και οι δυνατότητές μας. Μέσα από αυτό εκφράζονται οι ανάγκες, τα όρια, οι επιθυμίες και οι βαθύτερες αλήθειές μας.",
      "text_06": "Πιστεύουμε ότι η θεραπεία δεν αφορά μόνο τη γνωστική κατανόηση των δυσκολιών, αλλά τη βιωματική επαφή με ό,τι ζητά να ακουστεί, να αισθανθεί και να επανορθωθεί. Η αλλαγή δεν προκύπτει μόνο μέσα από την ανάλυση, αλλά μέσα από την παρουσία, την επίγνωση και τη ζωντανή εμπειρία στο «εδώ και τώρα».",
      "text_07": "Ο σκοπός μας",
      "text_08": "Μια κοινότητα ουσιαστικής θεραπείας και εξέλιξης",
      "text_09": "Η Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt υποστηρίζει το άτομο στο ταξίδι προς την ενοποίηση, την ενδυνάμωση και την αποκατάσταση της βαθύτερης σχέσης με τον εαυτό του. Μέσα από μια ασφαλή, σταθερή και ουσιαστική θεραπευτική σχέση, καλλιεργείται η επίγνωση του σώματος, των συναισθημάτων και των μοτίβων επαφής.",
      "text_10": "Ο Σύλλογος δημιουργήθηκε με σκοπό τη διάδοση και την προαγωγή της Σωματικά Επικεντρωμένης Ψυχοθεραπείας Gestalt, την εκπαίδευση και τη συνεχή επιμόρφωση επαγγελματιών, καθώς και τη στήριξη μιας κοινότητας ανθρώπων που αναζητούν ουσιαστική θεραπεία και προσωπική εξέλιξη.",
      "text_11": "Γιατί η θεραπεία ξεκινά από την επαφή — με το σώμα, με το συναίσθημα, με τον Άλλον και, τελικά, με τον ίδιο μας τον εαυτό.",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/1000s.jpg",
      "image_01_alt": "Το σώμα ως πηγή εμπειρίας",
      "image_02": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/depositphotos_60097259-stock-photo-people-celebrating-success-on-sunset.webp",
      "image_02_alt": "Ο σκοπός του Συλλόγου",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(1.9rem, 3.8vw, 2.75rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "98px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(0, 109, 105, 0.08)",
      "style_image_position": "center",
    },
  },
  {
    key: "unity",
    label: "Unity Energetics Institute",
    description: "Όλα τα στατικά κείμενα και οι εικόνες της ενότητας Unity Energetics.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · International Training School", kind: "text" },
      { key: "text_02", label: "Τίτλος · Unity Energetics Institute", kind: "text" },
      { key: "text_03", label: "Κείμενο · ΨΥΧΟΘΕΡΑΠΕΙΑΣ & ΣΥΜΒΟΥΛΕΥΤΙΚΗΣ", kind: "textarea" },
      { key: "text_04", label: "Κείμενο · Εμπνευστής και δημιουργός του Unity Energetics, είναι ο ψυχολόγο…", kind: "textarea" },
      { key: "text_05", label: "Τίτλος · Η τάση προς Ένωση και Ατομικότητα", kind: "text" },
      { key: "text_06", label: "Κείμενο · Την αδιάκοπη και ανυπέρβλητη Τάση της Ζωτικής Δύναμης και του αν…", kind: "textarea" },
      { key: "text_07", label: "Τίτλος · Οι δυναμικές διεργασίες", kind: "text" },
      { key: "text_08", label: "Κείμενο · Τις παραμέτρους & τις δυναμικές διεργασίες που συντελούνται αδιά…", kind: "textarea" },
      { key: "text_09", label: "Τίτλος · Τα βιώματα Ενότητας", kind: "text" },
      { key: "text_10", label: "Κείμενο · Ότι αυτές οι δυναμικές διεργασίες (Unity Energetics) επηρεάζουν …", kind: "textarea" },
      { key: "text_11", label: "Τίτλος · Η διαμόρφωση του ανθρώπινου ψυχισμού", kind: "text" },
      { key: "text_12", label: "Κείμενο · Ότι τα βιώματα Ενότητας καθορίζουν την διαμόρφωση του ανθρώπινου…", kind: "textarea" },
      { key: "text_13", label: "Ετικέτα · Ένωση · Ενότητα · Χωριστικότητα", kind: "text" },
      { key: "text_14", label: "Τίτλος · Η σχέση ανάμεσα στην Ατομικότητα και την Ένωση", kind: "text" },
      { key: "text_15", label: "Τίτλος · Όταν η Ατομικότητα γίνεται πιο ξεκάθαρη", kind: "text" },
      { key: "text_16", label: "Κείμενο · Κατ’ αναλογία, όσο πιο ξεκάθαρη είναι η βίωση της Ατομικότητας, …", kind: "textarea" },
      { key: "text_17", label: "Τίτλος · Όταν η διαδικασία της Ένωσης μπλοκάρεται", kind: "text" },
      { key: "text_18", label: "Κείμενο · Όταν η διαδικασία Ένωσης του ανθρώπου με άλλα Συστήματα μπλοκάρε…", kind: "textarea" },
      { key: "text_19", label: "Ετικέτα · Ψυχοθεραπευτική διαδικασία", kind: "text" },
      { key: "text_20", label: "Τίτλος · Η Ένωση ως κεντρικός θεραπευτικός άξονας", kind: "text" },
      { key: "text_21", label: "Κείμενο · Ότι η διαδικασία της Ένωσης, οι συντελούμενες δυναμικές διεργασί…", kind: "textarea" },
      { key: "text_22", label: "Τίτλος · Υποδεκτικότητα", kind: "text" },
      { key: "text_23", label: "Κείμενο · Βιώνει το αίσθημα της Υποδεκτικότητας από τον ψυχοθεραπευτή, η ο…", kind: "textarea" },
      { key: "text_24", label: "Τίτλος · Ένωση με τον Πυρήνα της Ύπαρξης", kind: "text" },
      { key: "text_25", label: "Κείμενο · Βιώνει Ένωση με τον Πυρήνα της Ύπαρξής του και ως εκ τούτου ξανα…", kind: "textarea" },
      { key: "text_26", label: "Τίτλος · Εξέλιξη της συνειδητότητας", kind: "text" },
      { key: "text_27", label: "Κείμενο · Εξελίσσει την συνειδητότητά του σε πολλαπλά επίπεδα.", kind: "textarea" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "image_02", label: "Εικόνα 2", kind: "image" },
      { key: "image_02_alt", label: "Εικόνα 2 · Alt / περιγραφή", kind: "text" },
      { key: "image_03", label: "Εικόνα 3", kind: "image" },
      { key: "image_03_alt", label: "Εικόνα 3 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "International Training School",
      "text_02": "Unity Energetics Institute",
      "text_03": "ΨΥΧΟΘΕΡΑΠΕΙΑΣ & ΣΥΜΒΟΥΛΕΥΤΙΚΗΣ",
      "text_04": "Εμπνευστής και δημιουργός του Unity Energetics, είναι ο ψυχολόγος-ψυχοθεραπευτής Ε. Λάζαρης ο οποίος από τις απαρχές της επαγγελματικής του πορείας, το 1988, χρησιμοποίησε τον όρο αυτό για να αναδείξει:",
      "text_05": "Η τάση προς Ένωση και Ατομικότητα",
      "text_06": "Την αδιάκοπη και ανυπέρβλητη Τάση της Ζωτικής Δύναμης και του ανθρώπινου ψυχισμού για: (Α) την υγιή Ένωσή του (Unity) με τη Ζωτική Δύναμη άλλων ανθρώπων ή/και με άλλα Συστήματα που συνυπάρχουν γύρω του και (Β) την εμπέδωση, ανάπτυξη και πραγμάτωση της Ατομικότητάς του.",
      "text_07": "Οι δυναμικές διεργασίες",
      "text_08": "Τις παραμέτρους & τις δυναμικές διεργασίες που συντελούνται αδιάλειπτα (Unity Energetics) σε όλα τα επίπεδα ενός ανθρώπινου οργανισμού κατά την διαδικασία της Ένωσης του με άλλα Συστήματα.",
      "text_09": "Τα βιώματα Ενότητας",
      "text_10": "Ότι αυτές οι δυναμικές διεργασίες (Unity Energetics) επηρεάζουν με μοναδικό κάθε φορά τρόπο τα βιώματα της Ενότητας (ενδο-οργανισμικά ή/και διαπροσωπικά), που δημιουργούνται κατά την διαδικασία της Ένωσης. Παραδείγματα ενδο-οργανισμικής Ενότητας είναι οι εμπειρίες ενοποίησης (Α) του σώματος – ψυχής – νου – συμπεριφοράς ή (Β) του παρελθόντος – παρόντος – μέλλοντος, που συνήθως εκλαμβάνονται ως υπερβατικές εμπειρίες, υπό την έννοια ότι υπερβαίνουμε την κατάσταση της Χωριστικότητας στην οποία είμαστε συνηθισμένοι.",
      "text_11": "Η διαμόρφωση του ανθρώπινου ψυχισμού",
      "text_12": "Ότι τα βιώματα Ενότητας καθορίζουν την διαμόρφωση του ανθρώπινου ψυχισμού περισσότερο από οποιονδήποτε άλλο παράγοντα, ιδιαιτέρως στα πρώιμα στάδια ανάπτυξης του ατόμου αλλά και κατά την ψυχοθεραπευτική διαδικασία, καθώς μέσα από αυτά αναπτύσσεται και ενισχύεται η Ατομικότητα.",
      "text_13": "Ένωση · Ενότητα · Χωριστικότητα",
      "text_14": "Η σχέση ανάμεσα στην Ατομικότητα και την Ένωση",
      "text_15": "Όταν η Ατομικότητα γίνεται πιο ξεκάθαρη",
      "text_16": "Κατ’ αναλογία, όσο πιο ξεκάθαρη είναι η βίωση της Ατομικότητας, τόσο πιο διαθέσιμο είναι το άτομο για εμπειρίες βαθειάς Ένωσης, τόσο ενδο-οργανισμικά όσο και διαπροσωπικά, και της συνεπακόλουθης αίσθησης Ενότητας.",
      "text_17": "Όταν η διαδικασία της Ένωσης μπλοκάρεται",
      "text_18": "Όταν η διαδικασία Ένωσης του ανθρώπου με άλλα Συστήματα μπλοκάρεται, τότε παρεκκλίνει από το αίσθημα της Ενότητας και βιώνει το αίσθημα της Χωριστικότητας, δηλαδή αποσχισμένος, αποκομμένος, απομονωμένος.",
      "text_19": "Ψυχοθεραπευτική διαδικασία",
      "text_20": "Η Ένωση ως κεντρικός θεραπευτικός άξονας",
      "text_21": "Ότι η διαδικασία της Ένωσης, οι συντελούμενες δυναμικές διεργασίες και η εμπειρία της Ενότητας με άλλα ενεργειακά συστήματα αποτελούν τους καταλυτικούς εκείνους παράγοντες που, όταν χρησιμοποιούνται ως κεντρικοί άξονες της ψυχοθεραπευτικής διαδικασίας, τότε ο θεραπευόμενος αποκτά την δυνατότητα να:",
      "text_22": "Υποδεκτικότητα",
      "text_23": "Βιώνει το αίσθημα της Υποδεκτικότητας από τον ψυχοθεραπευτή, η οποία αποτελεί τη θεμελιώδη προϋπόθεση προκειμένου ο θεραπευόμενος να μετασχηματίζει τα βαθύτερα τραύματα του επουλώνοντας τις ψυχικές του σχάσεις και ανακτώντας την απωλεσθείσα Ζωτική του Δύναμη.",
      "text_24": "Ένωση με τον Πυρήνα της Ύπαρξης",
      "text_25": "Βιώνει Ένωση με τον Πυρήνα της Ύπαρξής του και ως εκ τούτου ξανασυνδέεται με το ανεξάντλητο δυναμικό του και την υγιή Ατομικότητα του.",
      "text_26": "Εξέλιξη της συνειδητότητας",
      "text_27": "Εξελίσσει την συνειδητότητά του σε πολλαπλά επίπεδα.",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/05/image.png",
      "image_01_alt": "Unity Energetics Institute",
      "image_02": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/71ojUQV9MTL.jpg",
      "image_02_alt": "",
      "image_03": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/91lDAbpnUbL._AC_UF350350_QL80_.jpg",
      "image_03_alt": "",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#667875",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.4rem,5vw,4.6rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "88px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(23,75,73,.07)",
      "style_image_position": "center",
    },
  },
  {
    key: "approach",
    label: "Η Προσέγγιση Σ.Ε.ΨΥ.G.",
    description: "Η θεωρητική παρουσίαση της προσέγγισης, οι καταβολές και το Unity Energetics.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Η προσέγγιση", kind: "text" },
      { key: "text_02", label: "Τίτλος · Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt (Σ.Ε.ΨΥ.G.)", kind: "text" },
      { key: "text_03", label: "Κείμενο · Η Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt (Σ.Ε.ΨΥ.G.) αποτελ…", kind: "textarea" },
      { key: "text_04", label: "Ετικέτα · Αυτοτελής προσέγγιση", kind: "text" },
      { key: "text_05", label: "Τίτλος · Με δική της θεωρητική θεμελίωση, μεθοδολογία και τεχνικές", kind: "text" },
      { key: "text_06", label: "Κείμενο · Η Σ.Ε.ΨΥ.G. εντάσσεται στον ευρύτερο χώρο της Ραϊχικής Σωματικής…", kind: "textarea" },
      { key: "text_07", label: "Ετικέτα · Θεωρητικό πλαίσιο και επιστημονική βάση", kind: "text" },
      { key: "text_08", label: "Τίτλος · Τρεις βασικές ψυχοθεραπευτικές καταβολές", kind: "text" },
      { key: "text_09", label: "Κείμενο · Η Σ.Ε.ΨΥ.G. αντλεί γνώση και εμπειρία από τρεις ευρέως αναγνωρισ…", kind: "textarea" },
      { key: "text_10", label: "Τίτλος · Ραϊχική Σωματική Ψυχοθεραπεία", kind: "text" },
      { key: "text_11", label: "Κείμενο · Η Ραϊχική Σωματική Ψυχοθεραπεία αποτελεί μία από τις βασικές θεω…", kind: "textarea" },
      { key: "text_12", label: "Τίτλος · Κλασική Θεραπεία Gestalt", kind: "text" },
      { key: "text_13", label: "Κείμενο · Η κλασική Θεραπεία Gestalt αποτελεί δεύτερο βασικό πυλώνα γνώσης…", kind: "textarea" },
      { key: "text_14", label: "Τίτλος · Θεραπεία μέσω Αναδρομής", kind: "text" },
      { key: "text_15", label: "Κείμενο · Η Θεραπεία μέσω Αναδρομής (Regression Therapy) συνεισφέρει επίση…", kind: "textarea" },
      { key: "text_16", label: "Ετικέτα · Unity Energetics", kind: "text" },
      { key: "text_17", label: "Τίτλος · Μια νέα οπτική ενοποίησης και μεθοδολογικής καινοτομίας", kind: "text" },
      { key: "text_18", label: "Κείμενο · Η σχέση της με τις παραπάνω προσεγγίσεις δεν είναι συνθετική ή ε…", kind: "textarea" },
      { key: "text_19", label: "Ετικέτα · ενοποιεί τις θεωρητικές τους βάσεις υπό μια νέα οπτική (Unity En…", kind: "text" },
      { key: "text_20", label: "Ετικέτα · επεκτείνει το θεωρητικό τους πεδίο,", kind: "text" },
      { key: "text_21", label: "Ετικέτα · και εισάγει μεθοδολογική καινοτομία, μέσα από προηγμένα ψυχοθερα…", kind: "text" },
      { key: "text_22", label: "Ετικέτα · Κεντρικό οργανικό στοιχείο", kind: "text" },
      { key: "text_23", label: "Τίτλος · Ψυχο-Ενεργειακή Θεραπεία", kind: "text" },
      { key: "text_24", label: "Κείμενο · Κεντρικό και οργανικό στοιχείο της προσέγγισης αποτελεί η Ψυχο-Ε…", kind: "textarea" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "image_02", label: "Εικόνα 2", kind: "image" },
      { key: "image_02_alt", label: "Εικόνα 2 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Η προσέγγιση",
      "text_02": "Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt (Σ.Ε.ΨΥ.G.)",
      "text_03": "Η Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt (Σ.Ε.ΨΥ.G.) αποτελεί μια σύγχρονη, πρωτοπόρα και επανορθωτική ψυχοθεραπευτική προσέγγιση, με άμεση και ουσιαστική θεραπευτική δράση στα βαθύτερα επίπεδα του ψυχικού τραύματος και της Ζωτικής Δύναμης του ανθρώπου. Στόχος της είναι η ενοποίηση, η ενδυνάμωση και η αποκατάσταση της εσωτερικής συνοχής του ατόμου, μέσα από μια βαθιά βιωματική θεραπευτική διαδικασία.",
      "text_04": "Αυτοτελής προσέγγιση",
      "text_05": "Με δική της θεωρητική θεμελίωση, μεθοδολογία και τεχνικές",
      "text_06": "Η Σ.Ε.ΨΥ.G. εντάσσεται στον ευρύτερο χώρο της Ραϊχικής Σωματικής Ψυχοθεραπείας, ωστόσο συνιστά μια αυτοτελή και ολοκληρωμένη ψυχοθεραπευτική πρόταση, με δική της θεωρητική θεμελίωση, μεθοδολογία και εξειδικευμένες τεχνικές. Διακρίνεται για την αποτελεσματικότητά της στην επεξεργασία τόσο του ατομικού όσο και του προγονικού (διαγενεακού) τραύματος, επενεργώντας άμεσα στον τραυματισμένο Ψυχικό Πυρήνα του θεραπευόμενου.",
      "text_07": "Θεωρητικό πλαίσιο και επιστημονική βάση",
      "text_08": "Τρεις βασικές ψυχοθεραπευτικές καταβολές",
      "text_09": "Η Σ.Ε.ΨΥ.G. αντλεί γνώση και εμπειρία από τρεις ευρέως αναγνωρισμένες και επιδραστικές ψυχοθεραπευτικές προσεγγίσεις:",
      "text_10": "Ραϊχική Σωματική Ψυχοθεραπεία",
      "text_11": "Η Ραϊχική Σωματική Ψυχοθεραπεία αποτελεί μία από τις βασικές θεωρητικές και βιωματικές καταβολές της προσέγγισης.",
      "text_12": "Κλασική Θεραπεία Gestalt",
      "text_13": "Η κλασική Θεραπεία Gestalt αποτελεί δεύτερο βασικό πυλώνα γνώσης και εμπειρίας για την ανάπτυξη της Σ.Ε.ΨΥ.G.",
      "text_14": "Θεραπεία μέσω Αναδρομής",
      "text_15": "Η Θεραπεία μέσω Αναδρομής (Regression Therapy) συνεισφέρει επίσης στο θεωρητικό και θεραπευτικό πεδίο της προσέγγισης.",
      "text_16": "Unity Energetics",
      "text_17": "Μια νέα οπτική ενοποίησης και μεθοδολογικής καινοτομίας",
      "text_18": "Η σχέση της με τις παραπάνω προσεγγίσεις δεν είναι συνθετική ή εκλεκτικιστική. Η Σ.Ε.ΨΥ.G.:",
      "text_19": "ενοποιεί τις θεωρητικές τους βάσεις υπό μια νέα οπτική (Unity Energetics),",
      "text_20": "επεκτείνει το θεωρητικό τους πεδίο,",
      "text_21": "και εισάγει μεθοδολογική καινοτομία, μέσα από προηγμένα ψυχοθεραπευτικά εργαλεία και πρωτότυπες τεχνικές.",
      "text_22": "Κεντρικό οργανικό στοιχείο",
      "text_23": "Ψυχο-Ενεργειακή Θεραπεία",
      "text_24": "Κεντρικό και οργανικό στοιχείο της προσέγγισης αποτελεί η Ψυχο-Ενεργειακή Θεραπεία, θεραπευτική γνώση του Unity Energetics Institute (από το 1988), η οποία ενσωματώνεται ουσιαστικά στη θεραπευτική διαδικασία.",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/drawing-man-with-words-word-it_944525-52084.avif",
      "image_01_alt": "",
      "image_02": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/Breathing-Exercise.avif",
      "image_02_alt": "",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#667875",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.35rem,5vw,4.4rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "88px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(23,75,73,.07)",
      "style_image_position": "center",
    },
  },
  {
    key: "members_friends",
    label: "Μέλη & Φίλοι",
    description: "Το δημόσιο block Μελών & Φίλων. Τα ονόματα/μετρητές παραμένουν δυναμικά από τη Διαχείριση Συλλόγου.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Η κοινότητά μας", kind: "text" },
      { key: "text_02", label: "Τίτλος · Μέλη & Φίλοι Συλλόγου", kind: "text" },
      { key: "text_03", label: "Κείμενο · Οι άνθρωποι που αποτελούν και στηρίζουν την κοινότητα του Πανευρ…", kind: "textarea" },
      { key: "text_04", label: "Ετικέτα · Η κοινότητά μας", kind: "text" },
      { key: "text_05", label: "Τίτλος · Μέλη Συλλόγου", kind: "text" },
      { key: "text_06", label: "Ετικέτα · Στηρίζουν τον Σύλλογο", kind: "text" },
      { key: "text_07", label: "Τίτλος · Φίλοι Συλλόγου", kind: "text" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Η κοινότητά μας",
      "text_02": "Μέλη & Φίλοι Συλλόγου",
      "text_03": "Οι άνθρωποι που αποτελούν και στηρίζουν την κοινότητα του Πανευρωπαϊκού Επιστημονικού Συλλόγου Σ.Ε.ΨΥ.G.",
      "text_04": "Η κοινότητά μας",
      "text_05": "Μέλη Συλλόγου",
      "text_06": "Στηρίζουν τον Σύλλογο",
      "text_07": "Φίλοι Συλλόγου",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/group-of-business-team-members-raising-hands-in-the-sunset-sky-background-to-depict-teamwork-free-photo-1.jpg",
      "image_01_alt": "Η κοινότητα του Συλλόγου",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.3rem,5vw,4.2rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.72",
      "style_section_padding": "72px 7vw",
      "style_card_radius": "14px",
      "style_card_shadow": "none",
      "style_image_position": "center",
    },
  },
  {
    key: "board_public",
    label: "Διοικητικό Συμβούλιο · Δημόσιο",
    description: "Το δημόσιο block του Διοικητικού. Τα πρόσωπα/ρόλοι παραμένουν δυναμικά από τη Διαχείριση Συλλόγου.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Διοίκηση του Συλλόγου", kind: "text" },
      { key: "text_02", label: "Τίτλος · Διοικητικό Συμβούλιο", kind: "text" },
      { key: "text_03", label: "Κείμενο · Τα μέλη του Διοικητικού Συμβουλίου του Πανευρωπαϊκού Επιστημονικ…", kind: "textarea" },
      { key: "text_04", label: "Ετικέτα · Θητείες", kind: "text" },
      { key: "text_05", label: "Τίτλος · Διοικητικά Συμβούλια", kind: "text" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Διοίκηση του Συλλόγου",
      "text_02": "Διοικητικό Συμβούλιο",
      "text_03": "Τα μέλη του Διοικητικού Συμβουλίου του Πανευρωπαϊκού Επιστημονικού Συλλόγου Σ.Ε.ΨΥ.G. ανά περίοδο θητείας.",
      "text_04": "Θητείες",
      "text_05": "Διοικητικά Συμβούλια",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/group-of-business-team-members-raising-hands-in-the-sunset-sky-background-to-depict-teamwork-free-photo-1.jpg",
      "image_01_alt": "Διοικητικό Συμβούλιο",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.3rem,5vw,4.2rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.72",
      "style_section_padding": "72px 7vw",
      "style_card_radius": "24px",
      "style_card_shadow": "0 14px 34px rgba(23,75,73,.06)",
      "style_image_position": "center",
    },
  },
  {
    key: "therapists_public",
    label: "Θεραπευτές Συλλόγου · Δημόσιο",
    description: "Το εισαγωγικό block του χάρτη θεραπευτών. Τα προφίλ παραμένουν στο σύστημα Χάρτη.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Δίκτυο θεραπευτών", kind: "text" },
      { key: "text_02", label: "Τίτλος · Θεραπευτές του Συλλόγου", kind: "text" },
      { key: "text_03", label: "Κείμενο · Γνώρισε τους θεραπευτές του Πανευρωπαϊκού Επιστημονικού Συλλόγου…", kind: "textarea" },
      { key: "text_04", label: "Κείμενο · Επίλεξε μια πινέζα ή μια περιοχή και δες παρακάτω όλους τους θερ…", kind: "textarea" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Δίκτυο θεραπευτών",
      "text_02": "Θεραπευτές του Συλλόγου",
      "text_03": "Γνώρισε τους θεραπευτές του Πανευρωπαϊκού Επιστημονικού Συλλόγου Σ.Ε.ΨΥ.G. και αναζήτησε τον επαγγελματία που βρίσκεται στην περιοχή που σε ενδιαφέρει.",
      "text_04": "Επίλεξε μια πινέζα ή μια περιοχή και δες παρακάτω όλους τους θεραπευτές οργανωμένους ανά περιοχή.",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/360_F_603211204_pC06ntrzN95QQLs0J0DVTwlNAFqZUjFJ-1.jpg",
      "image_01_alt": "Θεραπευτές του Συλλόγου Σ.Ε.ΨΥ.G.",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.4rem,5vw,4.4rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "70px 6vw",
      "style_card_radius": "24px",
      "style_card_shadow": "none",
      "style_image_position": "center",
    },
  },
  {
    key: "become_member",
    label: "Γίνε Μέλος · Παρουσίαση",
    description: "Η αναλυτική ενότητα για μέλη/φίλους και τα οφέλη συμμετοχής.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Γίνε μέλος", kind: "text" },
      { key: "text_02", label: "Τίτλος · Μια ανοιχτή κοινότητα", kind: "text" },
      { key: "text_03", label: "Κείμενο · Ο Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G. είναι μια ανοιχ…", kind: "textarea" },
      { key: "text_04", label: "Κείμενο · Στόχος μας είναι να δημιουργούμε έναν χώρο επικοινωνίας, ανταλλα…", kind: "textarea" },
      { key: "text_05", label: "Τίτλος · Απευθυνόμαστε σε σένα αν είσαι:", kind: "text" },
      { key: "text_06", label: "Κείμενο · Επαγγελματίας ή εκπαιδευόμενος/η στην Ψυχοθεραπεία και στη Συμβο…", kind: "textarea" },
      { key: "text_07", label: "Κείμενο · Επαγγελματίας συγγενούς πεδίου.", kind: "textarea" },
      { key: "text_08", label: "Κείμενο · Άνθρωπος που ενδιαφέρεται για την αυτογνωσία, την προσωπική ανάπ…", kind: "textarea" },
      { key: "text_09", label: "Ετικέτα · Η συμμετοχή σου στον Σύλλογο δεν προϋποθέτει ειδικές γνώσεις ή ε…", kind: "textarea" },
      { key: "text_10", label: "Τίτλος · Ως Φίλος του Συλλόγου", kind: "text" },
      { key: "text_11", label: "Κείμενο · Οι Φίλοι του Σ.Ε.ΨΥ.G. έχουν τη δυνατότητα να βρίσκονται πιο κον…", kind: "textarea" },
      { key: "text_12", label: "Τίτλος · Ενημέρωση σε όλες τις δράσεις", kind: "text" },
      { key: "text_13", label: "Κείμενο · Μέσω email ενημερώνεσαι για όλα τα βιωματικά εργαστήρια, τα σεμι…", kind: "textarea" },
      { key: "text_14", label: "Τίτλος · Ειδικές εκπτώσεις", kind: "text" },
      { key: "text_15", label: "Κείμενο · Στις δράσεις του Συλλόγου που έχουν οικονομική συμμετοχή, απολαμ…", kind: "textarea" },
      { key: "text_16", label: "Τίτλος · Συνεργαζόμενοι θεραπευτές", kind: "text" },
      { key: "text_17", label: "Κείμενο · Μπορείς να απευθύνεσαι σε θεραπευτές που συνεργάζονται με τον Σύ…", kind: "textarea" },
      { key: "text_18", label: "Τίτλος · Στηρίζεις την κοινότητα", kind: "text" },
      { key: "text_19", label: "Κείμενο · Συμμετέχεις ενεργά σε μια κοινότητα ανθρώπων με κοινές αναζητήσε…", kind: "textarea" },
      { key: "text_20", label: "Τίτλος · Δήλωσε ενδιαφέρον", kind: "text" },
      { key: "text_21", label: "Κείμενο · Συμπλήρωσε τη φόρμα παρακάτω — τα στοιχεία σου φτάνουν αυτόματα …", kind: "textarea" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "frame_01_url", label: "URL ενσωματωμένης φόρμας / iframe 1", kind: "url" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Γίνε μέλος",
      "text_02": "Μια ανοιχτή κοινότητα",
      "text_03": "Ο Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G. είναι μια ανοιχτή κοινότητα ανθρώπων που συναντιούνται μέσα από ένα κοινό ενδιαφέρον για το σώμα, τη σχέση, την αυτογνωσία και τη βιωμένη εμπειρία στο εδώ και τώρα.",
      "text_04": "Στόχος μας είναι να δημιουργούμε έναν χώρο επικοινωνίας, ανταλλαγής, μάθησης και ουσιαστικής επαφής, μέσα από εκπαιδευτικές, επιστημονικές και βιωματικές δράσεις που φέρνουν τους ανθρώπους πιο κοντά στον εαυτό τους και στους άλλους.",
      "text_05": "Απευθυνόμαστε σε σένα αν είσαι:",
      "text_06": "Επαγγελματίας ή εκπαιδευόμενος/η στην Ψυχοθεραπεία και στη Συμβουλευτική της προσέγγισης Gestalt.",
      "text_07": "Επαγγελματίας συγγενούς πεδίου.",
      "text_08": "Άνθρωπος που ενδιαφέρεται για την αυτογνωσία, την προσωπική ανάπτυξη και τη σχέση σώματος–ψυχισμού.",
      "text_09": "Η συμμετοχή σου στον Σύλλογο δεν προϋποθέτει ειδικές γνώσεις ή επαγγελματική ιδιότητα. Χρειάζεται μόνο ενδιαφέρον, διάθεση για επαφή, συμμετοχή και παρουσία.",
      "text_10": "Ως Φίλος του Συλλόγου",
      "text_11": "Οι Φίλοι του Σ.Ε.ΨΥ.G. έχουν τη δυνατότητα να βρίσκονται πιο κοντά στις δράσεις και στην κοινότητά μας.",
      "text_12": "Ενημέρωση σε όλες τις δράσεις",
      "text_13": "Μέσω email ενημερώνεσαι για όλα τα βιωματικά εργαστήρια, τα σεμινάρια, τις εκπαιδεύσεις και τις πρωτοβουλίες του Συλλόγου — δωρεάν ή με κόστος συμμετοχής.",
      "text_14": "Ειδικές εκπτώσεις",
      "text_15": "Στις δράσεις του Συλλόγου που έχουν οικονομική συμμετοχή, απολαμβάνεις ειδικές εκπτώσεις και προνομιακές τιμές.",
      "text_16": "Συνεργαζόμενοι θεραπευτές",
      "text_17": "Μπορείς να απευθύνεσαι σε θεραπευτές που συνεργάζονται με τον Σύλλογο και, όπου είναι διαθέσιμο, να επωφελείσαι από ειδική τιμή Φίλου.",
      "text_18": "Στηρίζεις την κοινότητα",
      "text_19": "Συμμετέχεις ενεργά σε μια κοινότητα ανθρώπων με κοινές αναζητήσεις και στηρίζεις τη συνέχιση των ανοιχτών, δωρεάν πρωτοβουλιών του Συλλόγου.",
      "text_20": "Δήλωσε ενδιαφέρον",
      "text_21": "Συμπλήρωσε τη φόρμα παρακάτω — τα στοιχεία σου φτάνουν αυτόματα σε εμάς.",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/360_F_603211204_pC06ntrzN95QQLs0J0DVTwlNAFqZUjFJ.jpg",
      "image_01_alt": "",
      "frame_01_url": "https://docs.google.com/forms/d/e/1FAIpQLSdFuxPE_hY4hYftsEd-jC2t_lDaB0tFW8I8ZKTI9foopZEJCw/viewform?embedded=true",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.45rem,5vw,4.4rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "94px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(23,75,73,.07)",
      "style_image_position": "center",
    },
  },
  {
    key: "menu",
    label: "Header / Menu",
    description: "Logo, ονομασία, labels και links του κεντρικού menu.",
    connected: true,
    fields: [
      { key: "text_01", label: "Μικρό κείμενο · Πανευρωπαϊκός Επιστημονικός Σύλλογος", kind: "text" },
      { key: "text_02", label: "Menu · Ο Σύλλογος ⌄", kind: "text" },
      { key: "text_03", label: "Κουμπί / σύνδεσμος · Αρχική", kind: "text" },
      { key: "text_04", label: "Κουμπί / σύνδεσμος · Το όραμά μας", kind: "text" },
      { key: "text_05", label: "Menu · Η Προσέγγιση ⌄", kind: "text" },
      { key: "text_06", label: "Κουμπί / σύνδεσμος · Η Προσέγγιση Σ.Ε.ΨΥ.G.", kind: "text" },
      { key: "text_07", label: "Κουμπί / σύνδεσμος · Unity Energetics Institute", kind: "text" },
      { key: "text_08", label: "Κουμπί / σύνδεσμος · Δράσεις", kind: "text" },
      { key: "text_09", label: "Κουμπί / σύνδεσμος · Άρθρα", kind: "text" },
      { key: "text_10", label: "Menu · Μέλη Συλλόγου ⌄", kind: "text" },
      { key: "text_11", label: "Κουμπί / σύνδεσμος · Μέλη Συλλόγου", kind: "text" },
      { key: "text_12", label: "Κουμπί / σύνδεσμος · Θεραπευτές Συλλόγου", kind: "text" },
      { key: "text_13", label: "Κουμπί / σύνδεσμος · Διοικητικό Συμβούλιο", kind: "text" },
      { key: "text_14", label: "Κουμπί / σύνδεσμος · Γίνε Μέλος", kind: "text" },
      { key: "text_15", label: "Κουμπί / σύνδεσμος · Επικοινωνία", kind: "text" },
      { key: "text_16", label: "Κουμπί / σύνδεσμος · Login", kind: "text" },
      { key: "text_17", label: "Menu · Ο Σύλλογος ＋", kind: "text" },
      { key: "text_18", label: "Κουμπί / σύνδεσμος · Αρχική", kind: "text" },
      { key: "text_19", label: "Κουμπί / σύνδεσμος · Το όραμά μας", kind: "text" },
      { key: "text_20", label: "Menu · Η Προσέγγιση ＋", kind: "text" },
      { key: "text_21", label: "Κουμπί / σύνδεσμος · Η Προσέγγιση Σ.Ε.ΨΥ.G.", kind: "text" },
      { key: "text_22", label: "Κουμπί / σύνδεσμος · Unity Energetics Institute", kind: "text" },
      { key: "text_23", label: "Κουμπί / σύνδεσμος · Δράσεις", kind: "text" },
      { key: "text_24", label: "Κουμπί / σύνδεσμος · Άρθρα", kind: "text" },
      { key: "text_25", label: "Menu · Μέλη Συλλόγου ＋", kind: "text" },
      { key: "text_26", label: "Κουμπί / σύνδεσμος · Μέλη Συλλόγου", kind: "text" },
      { key: "text_27", label: "Κουμπί / σύνδεσμος · Θεραπευτές Συλλόγου", kind: "text" },
      { key: "text_28", label: "Κουμπί / σύνδεσμος · Διοικητικό Συμβούλιο", kind: "text" },
      { key: "text_29", label: "Κουμπί / σύνδεσμος · Γίνε Μέλος", kind: "text" },
      { key: "text_30", label: "Κουμπί / σύνδεσμος · Επικοινωνία", kind: "text" },
      { key: "text_31", label: "Κουμπί / σύνδεσμος · Login", kind: "text" },
      { key: "link_01_url", label: "URL · Σ.Ε.ΨΥ.G. Πανευρωπαϊκός Επιστημονικός Σύλλογος", kind: "url" },
      { key: "link_02_url", label: "URL · Αρχική", kind: "url" },
      { key: "link_03_url", label: "URL · Το όραμά μας", kind: "url" },
      { key: "link_04_url", label: "URL · Η Προσέγγιση Σ.Ε.ΨΥ.G.", kind: "url" },
      { key: "link_05_url", label: "URL · Unity Energetics Institute", kind: "url" },
      { key: "link_06_url", label: "URL · Δράσεις", kind: "url" },
      { key: "link_07_url", label: "URL · Άρθρα", kind: "url" },
      { key: "link_08_url", label: "URL · Μέλη Συλλόγου", kind: "url" },
      { key: "link_09_url", label: "URL · Θεραπευτές Συλλόγου", kind: "url" },
      { key: "link_10_url", label: "URL · Διοικητικό Συμβούλιο", kind: "url" },
      { key: "link_11_url", label: "URL · Γίνε Μέλος", kind: "url" },
      { key: "link_12_url", label: "URL · Επικοινωνία", kind: "url" },
      { key: "link_13_url", label: "URL · Login", kind: "url" },
      { key: "link_14_url", label: "URL · Αρχική", kind: "url" },
      { key: "link_15_url", label: "URL · Το όραμά μας", kind: "url" },
      { key: "link_16_url", label: "URL · Η Προσέγγιση Σ.Ε.ΨΥ.G.", kind: "url" },
      { key: "link_17_url", label: "URL · Unity Energetics Institute", kind: "url" },
      { key: "link_18_url", label: "URL · Δράσεις", kind: "url" },
      { key: "link_19_url", label: "URL · Άρθρα", kind: "url" },
      { key: "link_20_url", label: "URL · Μέλη Συλλόγου", kind: "url" },
      { key: "link_21_url", label: "URL · Θεραπευτές Συλλόγου", kind: "url" },
      { key: "link_22_url", label: "URL · Διοικητικό Συμβούλιο", kind: "url" },
      { key: "link_23_url", label: "URL · Γίνε Μέλος", kind: "url" },
      { key: "link_24_url", label: "URL · Επικοινωνία", kind: "url" },
      { key: "link_25_url", label: "URL · Login", kind: "url" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Πανευρωπαϊκός Επιστημονικός Σύλλογος",
      "text_02": "Ο Σύλλογος ⌄",
      "text_03": "Αρχική",
      "text_04": "Το όραμά μας",
      "text_05": "Η Προσέγγιση ⌄",
      "text_06": "Η Προσέγγιση Σ.Ε.ΨΥ.G.",
      "text_07": "Unity Energetics Institute",
      "text_08": "Δράσεις",
      "text_09": "Άρθρα",
      "text_10": "Μέλη Συλλόγου ⌄",
      "text_11": "Μέλη Συλλόγου",
      "text_12": "Θεραπευτές Συλλόγου",
      "text_13": "Διοικητικό Συμβούλιο",
      "text_14": "Γίνε Μέλος",
      "text_15": "Επικοινωνία",
      "text_16": "Login",
      "text_17": "Ο Σύλλογος ＋",
      "text_18": "Αρχική",
      "text_19": "Το όραμά μας",
      "text_20": "Η Προσέγγιση ＋",
      "text_21": "Η Προσέγγιση Σ.Ε.ΨΥ.G.",
      "text_22": "Unity Energetics Institute",
      "text_23": "Δράσεις",
      "text_24": "Άρθρα",
      "text_25": "Μέλη Συλλόγου ＋",
      "text_26": "Μέλη Συλλόγου",
      "text_27": "Θεραπευτές Συλλόγου",
      "text_28": "Διοικητικό Συμβούλιο",
      "text_29": "Γίνε Μέλος",
      "text_30": "Επικοινωνία",
      "text_31": "Login",
      "link_01_url": "#home",
      "link_02_url": "#home",
      "link_03_url": "#vision",
      "link_04_url": "#sepsyg-approach",
      "link_05_url": "#unity-energetics",
      "link_06_url": "#activities",
      "link_07_url": "#arthra",
      "link_08_url": "#members-association",
      "link_09_url": "#therapists",
      "link_10_url": "#board",
      "link_11_url": "#membership",
      "link_12_url": "#contact-social",
      "link_13_url": "https://hmerologiosillogou.vercel.app/portal",
      "link_14_url": "#home",
      "link_15_url": "#vision",
      "link_16_url": "#sepsyg-approach",
      "link_17_url": "#unity-energetics",
      "link_18_url": "#activities",
      "link_19_url": "#arthra",
      "link_20_url": "#members-association",
      "link_21_url": "#therapists",
      "link_22_url": "#board",
      "link_23_url": "#membership",
      "link_24_url": "#contact-social",
      "link_25_url": "https://hmerologiosillogou.vercel.app/portal",
      "style_section_background": "#FFFFFF",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#667875",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "1.24rem",
      "style_body_size": "0.83rem",
      "style_line_height": "1.35",
      "style_section_padding": "0",
      "style_card_radius": "16px",
      "style_card_shadow": "0 18px 45px rgba(23,75,73,.13)",
      "style_image_position": "center",
    },
  },
  {
    key: "contact",
    label: "Επικοινωνία",
    description: "Το κύριο block επικοινωνίας. Email, τηλέφωνα και διεύθυνση συνδέονται και με τα Γενικά στοιχεία.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · Επικοινωνία", kind: "text" },
      { key: "text_02", label: "Τίτλος · Ελάτε σε επαφή", kind: "text" },
      { key: "text_03", label: "Κείμενο · Σας προσκαλούμε να επικοινωνήσετε για οποιαδήποτε πληροφορία σχε…", kind: "textarea" },
      { key: "text_04", label: "Κείμενο · Είτε έχετε απορίες για τις δραστηριότητές μας, είτε θέλετε να εν…", kind: "textarea" },
      { key: "text_05", label: "Τίτλος · Email", kind: "text" },
      { key: "text_06", label: "Κουμπί / σύνδεσμος · euassociationsepsyg@gmail.com", kind: "text" },
      { key: "text_07", label: "Τίτλος · Τηλέφωνα επικοινωνίας", kind: "text" },
      { key: "text_08", label: "Κουμπί / σύνδεσμος · 693 796 2301", kind: "text" },
      { key: "text_09", label: "Κουμπί / σύνδεσμος · 694 064 5022", kind: "text" },
      { key: "text_10", label: "Τίτλος · Διεύθυνση", kind: "text" },
      { key: "text_11", label: "Κείμενο · Πολυτεχνίου 37 Θεσσαλονίκη, ΤΚ 54626", kind: "textarea" },
      { key: "text_12", label: "Τίτλος · Ακολουθήστε μας", kind: "text" },
      { key: "text_13", label: "Κουμπί / σύνδεσμος · f Facebook", kind: "text" },
      { key: "image_01", label: "Εικόνα 1", kind: "image" },
      { key: "image_01_alt", label: "Εικόνα 1 · Alt / περιγραφή", kind: "text" },
      { key: "link_01_url", label: "URL · euassociationsepsyg@gmail.com", kind: "url" },
      { key: "link_02_url", label: "URL · 693 796 2301", kind: "url" },
      { key: "link_03_url", label: "URL · 694 064 5022", kind: "url" },
      { key: "link_04_url", label: "URL · f Facebook", kind: "url" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "Επικοινωνία",
      "text_02": "Ελάτε σε επαφή",
      "text_03": "Σας προσκαλούμε να επικοινωνήσετε για οποιαδήποτε πληροφορία σχετικά με τον Πανευρωπαϊκό Επιστημονικό Σύλλογο Σ.Ε.ΨΥ.G.",
      "text_04": "Είτε έχετε απορίες για τις δραστηριότητές μας, είτε θέλετε να ενημερωθείτε για σεμινάρια και ομάδες, είτε απλώς θέλετε να μοιραστείτε ένα μήνυμα.",
      "text_05": "Email",
      "text_06": "euassociationsepsyg@gmail.com",
      "text_07": "Τηλέφωνα επικοινωνίας",
      "text_08": "693 796 2301",
      "text_09": "694 064 5022",
      "text_10": "Διεύθυνση",
      "text_11": "Πολυτεχνίου 37 Θεσσαλονίκη, ΤΚ 54626",
      "text_12": "Ακολουθήστε μας",
      "text_13": "f Facebook",
      "image_01": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/contact-us-concept.jpg",
      "image_01_alt": "Επικοινωνία με τον Σύλλογο Σ.Ε.ΨΥ.G.",
      "link_01_url": "mailto:euassociationsepsyg@gmail.com",
      "link_02_url": "tel:+306937962301",
      "link_03_url": "tel:+306940645022",
      "link_04_url": "https://www.facebook.com/share/g/17TTMo8AWK/",
      "style_section_background": "#FFF9F3",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.4rem,5vw,4.4rem)",
      "style_body_size": "0.98rem",
      "style_line_height": "1.75",
      "style_section_padding": "92px 0",
      "style_card_radius": "24px",
      "style_card_shadow": "0 16px 38px rgba(23,75,73,.07)",
      "style_image_position": "center",
    },
  },
  {
    key: "footer",
    label: "Footer",
    description: "Το κάτω μέρος της σελίδας με στοιχεία Συλλόγου, επικοινωνία και social.",
    connected: true,
    fields: [
      { key: "text_01", label: "Ετικέτα · ✦ Επικοινωνία", kind: "text" },
      { key: "text_02", label: "Τίτλος · Έλα σε επαφή", kind: "text" },
      { key: "text_03", label: "Κείμενο · Επικοινώνησε με τον Πανευρωπαϊκό Επιστημονικό Σύλλογο Σ.Ε.ΨΥ.G. …", kind: "textarea" },
      { key: "text_04", label: "Τίτλος · Ο Σύλλογός μας", kind: "text" },
      { key: "text_05", label: "Κείμενο · Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.", kind: "textarea" },
      { key: "text_06", label: "Κείμενο · Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt", kind: "textarea" },
      { key: "text_07", label: "Κείμενο · Πολυτεχνίου 37, Θεσσαλονίκη, ΤΚ 54626", kind: "textarea" },
      { key: "text_08", label: "Τίτλος · Επικοινώνησε μαζί μας", kind: "text" },
      { key: "text_09", label: "Κουμπί / σύνδεσμος · euassociationsepsyg@gmail.com", kind: "text" },
      { key: "text_10", label: "Κουμπί / σύνδεσμος · 693 796 2301", kind: "text" },
      { key: "text_11", label: "Κουμπί / σύνδεσμος · 694 064 5022", kind: "text" },
      { key: "text_12", label: "Τίτλος · Ακολούθησέ μας", kind: "text" },
      { key: "text_13", label: "Κείμενο · Νέα, δράσεις και ανακοινώσεις του Συλλόγου.", kind: "textarea" },
      { key: "text_14", label: "Κουμπί / σύνδεσμος · f Facebook", kind: "text" },
      { key: "link_01_url", label: "URL · euassociationsepsyg@gmail.com", kind: "url" },
      { key: "link_02_url", label: "URL · 693 796 2301", kind: "url" },
      { key: "link_03_url", label: "URL · 694 064 5022", kind: "url" },
      { key: "link_04_url", label: "URL · f Facebook", kind: "url" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_card_background", label: "Φόντο καρτών", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλων", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_border_color", label: "Χρώμα borders", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλων", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος κύριου τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κύριου κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
      { key: "style_section_padding", label: "Κενό / padding ενότητας", kind: "text", group: "appearance" },
      { key: "style_card_radius", label: "Border radius καρτών", kind: "text", group: "appearance" },
      { key: "style_card_shadow", label: "Σκιά καρτών", kind: "text", group: "appearance" },
      { key: "style_image_position", label: "Θέση εικόνας (object-position)", kind: "text", group: "appearance" },
    ],
    defaults: {
      "text_01": "✦ Επικοινωνία",
      "text_02": "Έλα σε επαφή",
      "text_03": "Επικοινώνησε με τον Πανευρωπαϊκό Επιστημονικό Σύλλογο Σ.Ε.ΨΥ.G. για πληροφορίες, δράσεις και θέματα συμμετοχής.",
      "text_04": "Ο Σύλλογός μας",
      "text_05": "Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.",
      "text_06": "Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt",
      "text_07": "Πολυτεχνίου 37, Θεσσαλονίκη, ΤΚ 54626",
      "text_08": "Επικοινώνησε μαζί μας",
      "text_09": "euassociationsepsyg@gmail.com",
      "text_10": "693 796 2301",
      "text_11": "694 064 5022",
      "text_12": "Ακολούθησέ μας",
      "text_13": "Νέα, δράσεις και ανακοινώσεις του Συλλόγου.",
      "text_14": "f Facebook",
      "link_01_url": "mailto:euassociationsepsyg@gmail.com",
      "link_02_url": "tel:+306937962301",
      "link_03_url": "tel:+306940645022",
      "link_04_url": "https://www.facebook.com/",
      "style_section_background": "#174B49",
      "style_card_background": "#FFFFFF",
      "style_heading_color": "#FFFFFF",
      "style_body_color": "#FFFFFF",
      "style_accent_color": "#E1AF85",
      "style_border_color": "#DDE4E2",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2rem,4vw,3.2rem)",
      "style_body_size": "0.9rem",
      "style_line_height": "1.7",
      "style_section_padding": "72px 0 0",
      "style_card_radius": "18px",
      "style_card_shadow": "none",
      "style_image_position": "center",
    },
  },
  {
    key: "articles",
    label: "Άρθρα",
    description: "Hero της ενότητας Άρθρων. Το divider και το video παραμένουν συνδεδεμένα με το δημόσιο embed.",
    connected: true,
    fields: [
      { key: "eyebrow", label: "Μικρός τίτλος", kind: "text" },
      { key: "title", label: "Τίτλος", kind: "text" },
      { key: "intro", label: "Περιγραφή", kind: "textarea" },
      { key: "video_url", label: "Video hero", kind: "url" },
      { key: "video_badge", label: "Ετικέτα πάνω στο video", kind: "text" },
      { key: "style_section_background", label: "Φόντο ενότητας", kind: "color", group: "appearance" },
      { key: "style_heading_color", label: "Χρώμα τίτλου", kind: "color", group: "appearance" },
      { key: "style_body_color", label: "Χρώμα κειμένου", kind: "color", group: "appearance" },
      { key: "style_accent_color", label: "Accent χρώμα", kind: "color", group: "appearance" },
      { key: "style_heading_font", label: "Γραμματοσειρά τίτλου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_body_font", label: "Γραμματοσειρά κειμένου", kind: "select", group: "appearance", options: WEBSITE_FONT_OPTIONS },
      { key: "style_title_size", label: "Μέγεθος τίτλου", kind: "text", group: "appearance" },
      { key: "style_body_size", label: "Μέγεθος κειμένου", kind: "text", group: "appearance" },
      { key: "style_line_height", label: "Διάστιχο", kind: "text", group: "appearance" },
    ],
    defaults: {
      "eyebrow": "Γνώση · Εμπειρία · Εφαρμογή",
      "title": "Άρθρα",
      "intro": "Κείμενα για την ανθρώπινη επαφή, την επικοινωνία, τη θεραπευτική σχέση και τη Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt.",
      "video_url": "https://demo.unityenergetics.org/wp-content/uploads/2026/08/6279423-uhd_3840_2160_24fps-1.mp4",
      "video_badge": "Άρθρα & Προσεγγίσεις",
      "style_section_background": "#FFF9F3",
      "style_heading_color": "#174B49",
      "style_body_color": "#627472",
      "style_accent_color": "#008D8B",
      "style_heading_font": "Georgia, \"Times New Roman\", serif",
      "style_body_font": "Arial, Helvetica, sans-serif",
      "style_title_size": "clamp(2.35rem, 4.5vw, 4.15rem)",
      "style_body_size": "0.95rem",
      "style_line_height": "1.72",
    },
  },
];


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

function ManageApp({ role, embedded = false, memberName = "" }: { role: ManageRole; embedded?: boolean; memberName?: string }) {
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
    <div className={`sepsyg-manage-page ${embedded ? "sepsyg-manage-embedded" : "min-h-screen"} bg-slate-50 text-slate-900`}>
      {!embedded && <header className="border-b border-slate-200 bg-white">
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
              href="https://euassociationsepsyg.carrd.co/#"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Ιστοσελίδα Συλλόγου
            </a>
          </div>
        </div>
      </header>}

      <main className={`mx-auto ${embedded ? "max-w-5xl px-2 py-3 sm:px-3" : "max-w-6xl px-4 py-6 sm:px-6"}`}>
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
                    return <div key={`empty-${index}`} className={`h-14 rounded-md bg-slate-50/70 ${embedded ? "sm:h-20" : "sm:h-28"} sm:rounded-lg`} />;
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
                      className={`flex h-14 min-w-0 flex-col items-center justify-start rounded-md border p-1.5 text-center transition ${embedded ? "sm:h-20 sm:p-2" : "sm:h-28 sm:p-2.5"} sm:items-start sm:rounded-lg sm:text-left ${buttonClass}`}
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
          ownerName={memberName}
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
          canManage={viewBooking.status === "booked" && (role === "admin" || bookingOwnedByMember(viewBooking, memberName))}
          registrationCount={registrationCounts[viewBooking.booking_date] || 0}
          canViewRegistrationDetails={role === "admin"}
          canShareUrl={
            role === "admin" ||
            Boolean(memberName && [
              viewBooking.therapist_name,
              viewBooking.additional_coordinator_name,
              viewBooking.third_coordinator_name,
              viewBooking.fourth_coordinator_name,
            ].some((person) => normalizeTherapistName(person) === normalizeTherapistName(memberName)))
          }
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
          onMoved={(fromDate, movedBooking, movedRegistrationCount) => {
            setBookings((previous) => mergeBookings([
              ...previous.filter((item) => item.booking_date !== fromDate && item.id !== fromDate),
              movedBooking,
            ]));
            setRegistrationCounts((previous) => {
              const next = { ...previous };
              delete next[fromDate];
              next[movedBooking.booking_date] = movedRegistrationCount;
              return next;
            });
            setActiveMonth(movedBooking.booking_date.slice(0, 7));
            setViewBooking(movedBooking);
          }}
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
          ownerName={memberName}
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
        {booking.description && <p className="sepsyg-event-desc">{richTextToPlainText(booking.description)}</p>}
        <div className="sepsyg-event-meta">
          <span>📅 {formatDateGreek(booking.booking_date)}</span>
          <span>🕒 {booking.action_time || "Η ώρα θα ανακοινωθεί"}</span>
          {booking.location && <span>📍 {booking.location}</span>}
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
          {activityPriceLabel(booking) && <span>💶 {activityPriceLabel(booking)}</span>}
          {booking.offers_member_discount && booking.member_price && <span>★ Μέλη / Φίλοι: {booking.member_price}</span>}
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
  const [activeView, setActiveView] = useState<PublicView>("all");
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
  const [calendarExpanded, setCalendarExpanded] = useState(false);

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

    if (requestedView === "all" || requestedView === "upcoming") {
      setActiveView(requestedView);
    } else if (requestedView === "calendar") {
      setActiveView("all");
      setCalendarExpanded(true);
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
    () => bookings.filter((booking) => booking.is_public),
    [bookings],
  );

  const publicBookingsByDate = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const booking of publicBookings) map.set(booking.booking_date, booking);
    return map;
  }, [publicBookings]);

  const upcomingBookings = useMemo(
    () => publicBookings
      .filter((booking) => !isBookingCompleted(booking))
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date)),
    [publicBookings, today],
  );

  const allCards = useMemo(() => {
    const upcoming = publicBookings
      .filter((booking) => !isBookingCompleted(booking))
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
    const past = publicBookings
      .filter((booking) => isBookingCompleted(booking))
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
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
  const activeMonthIndex = Math.max(0, MONTHS.findIndex((item) => item.key === activeMonth));

  function showPreviousMonth() {
    if (activeMonthIndex <= 0) return;
    setActiveMonth(MONTHS[activeMonthIndex - 1].key);
  }

  function showNextMonth() {
    if (activeMonthIndex >= MONTHS.length - 1) return;
    setActiveMonth(MONTHS[activeMonthIndex + 1].key);
  }

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

  if (viewBooking) {
    return (
      <div className="sepsyg-public-page">
        <PublicBookingDetails
          booking={viewBooking}
          therapistDirectory={therapistDirectory}
          inlineMode
          onClose={() => setViewBooking(null)}
        />
      </div>
    );
  }

  return (
    <div className="sepsyg-public-page">
      <header className="sepsyg-public-hero sepsyg-public-hero-compact">
        <div className="sepsyg-public-wrap sepsyg-hero-inner sepsyg-hero-inner-compact">
          <div className="sepsyg-hero-brand-row">
            <AssociationLogo size="sm" centered={false} />
            <div>
              <p className="sepsyg-kicker">Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.</p>
              <h1>Δράσεις &amp; Εκδηλώσεις</h1>
            </div>
          </div>

          <p className="sepsyg-hero-copy">
            Σεμινάρια, βιωματικά εργαστήρια και συναντήσεις του Συλλόγου.
            Διάλεξε μια δράση για περισσότερες πληροφορίες και δήλωση συμμετοχής.
          </p>
        </div>
      </header>

      <main className="sepsyg-public-wrap sepsyg-public-main">
        {connectionError && <div className="sepsyg-alert"><strong>Πρόβλημα σύνδεσης:</strong> {connectionError}</div>}

        <section className="sepsyg-actions-calendar-layout">
          <div className="sepsyg-actions-column">
            <div className="sepsyg-column-heading">
              <div>
                <span>Δράσεις του Συλλόγου</span>
                <h2>{activeView === "upcoming" ? "Προσεχείς δράσεις" : "Όλες οι δράσεις του Συλλόγου"}</h2>
              </div>

              <div className="sepsyg-inline-tabs" aria-label="Φίλτρο δράσεων">
                <button
                  type="button"
                  className={activeView !== "upcoming" ? "active" : ""}
                  onClick={() => setActiveView("all")}
                >
                  Όλες οι δράσεις
                </button>
                <button
                  type="button"
                  className={activeView === "upcoming" ? "active" : ""}
                  onClick={() => setActiveView("upcoming")}
                >
                  Προσεχείς δράσεις
                </button>
              </div>
            </div>

            {visibleCards.length ? (
              <div className="sepsyg-events-grid sepsyg-events-grid-main">
                {visibleCards.map((booking) => (
                  <ActivityCard
                    key={booking.id}
                    booking={booking}
                    therapistDirectory={therapistDirectory}
                    onOpen={() => {
                      if (typeof window !== "undefined") {
                        window.parent !== window
                          ? window.parent.postMessage({ type: "SEPSYG_SCROLL_TO_EMBED_TOP", source: "calendar" }, "*")
                          : window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                      setViewBooking(booking);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="sepsyg-empty-state">Δεν υπάρχουν διαθέσιμες δράσεις αυτή τη στιγμή.</div>
            )}
          </div>

          <aside className="sepsyg-mini-calendar-panel">
            <div className="sepsyg-mini-calendar-heading">
              <div>
                <span>Ημερολόγιο</span>
                <h2>{month.label}</h2>
              </div>

              <div className="sepsyg-mini-month-nav">
                <button
                  type="button"
                  onClick={showPreviousMonth}
                  disabled={activeMonthIndex <= 0}
                  aria-label="Προηγούμενος μήνας"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={showNextMonth}
                  disabled={activeMonthIndex >= MONTHS.length - 1}
                  aria-label="Επόμενος μήνας"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="sepsyg-mini-weekdays">
              {WEEKDAYS.map((weekday) => <div key={weekday}>{weekday.slice(0, 2)}</div>)}
            </div>

            <div className="sepsyg-mini-grid">
              {calendarCells.map((day, index) => {
                if (day === null) return <div key={`mini-empty-${index}`} className="sepsyg-mini-day empty" />;

                const date = toDateString(month.year, month.month, day);
                const booking = publicBookingsByDate.get(date);

                return (
                  <button
                    key={date}
                    type="button"
                    className={`sepsyg-mini-day ${booking ? "has-event" : ""} ${booking ? activityCategoryClass(booking) : ""}`}
                    disabled={!booking}
                    onClick={() => booking && setViewBooking(booking)}
                    aria-label={booking ? `${day} ${month.label}: ${booking.topic || "Δράση Συλλόγου"}` : `${day} ${month.label}`}
                  >
                    <span>{day}</span>
                    {booking && <i aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="sepsyg-expand-calendar"
              onClick={() => setCalendarExpanded(true)}
            >
              Μεγέθυνση ημερολογίου
            </button>

            <p className="sepsyg-mini-calendar-note">
              Οι ημέρες με δράση έχουν μικρή χρωματική ένδειξη. Πάτησε την ημέρα για να ανοίξει η δράση.
            </p>
          </aside>
        </section>

        <div className="sepsyg-public-links">
          <a href="https://euassociationsepsyg.carrd.co/#" target="_blank" rel="noreferrer">Ιστοσελίδα Συλλόγου</a>
        </div>
      </main>

      {calendarExpanded && (
        <div
          className="sepsyg-calendar-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCalendarExpanded(false);
          }}
        >
          <div className="sepsyg-calendar-expand-card" role="dialog" aria-modal="true" aria-label="Μεγάλο ημερολόγιο δράσεων">
            <button
              type="button"
              className="sepsyg-calendar-expand-close"
              onClick={() => setCalendarExpanded(false)}
              aria-label="Κλείσιμο"
            >
              ×
            </button>

            <div className="sepsyg-calendar-expand-head">
              <div>
                <span>Ημερολόγιο δράσεων</span>
                <h2>{month.label}</h2>
              </div>

              <div className="sepsyg-calendar-expand-tools">
                <button type="button" onClick={showPreviousMonth} disabled={activeMonthIndex <= 0}>‹</button>
                <select value={activeMonth} onChange={(event) => setActiveMonth(event.target.value)}>
                  {MONTHS.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
                <button type="button" onClick={showNextMonth} disabled={activeMonthIndex >= MONTHS.length - 1}>›</button>
              </div>
            </div>

            <div className="sepsyg-calendar-expand-weekdays">
              {WEEKDAYS.map((weekday) => <div key={weekday}>{weekday}</div>)}
            </div>

            <div className="sepsyg-calendar-expand-grid">
              {calendarCells.map((day, index) => {
                if (day === null) return <div key={`expanded-empty-${index}`} className="sepsyg-calendar-expand-day empty" />;

                const date = toDateString(month.year, month.month, day);
                const booking = publicBookingsByDate.get(date);

                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!booking}
                    className={`sepsyg-calendar-expand-day ${booking ? "has-event" : ""} ${booking ? activityCategoryClass(booking) : ""}`}
                    onClick={() => {
                      if (!booking) return;
                      setCalendarExpanded(false);
                      setViewBooking(booking);
                    }}
                  >
                    <span>{day}</span>
                    {booking && <i aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            <p className="sepsyg-calendar-expand-note">
              Πάτησε μια ημέρα με ένδειξη για να ανοίξεις τη συγκεκριμένη δράση.
            </p>
          </div>
        </div>
      )}

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
  previewMode = false,
  inlineMode = false,
}: {
  booking: Booking;
  therapistDirectory: TherapistDirectoryItem[];
  onClose: () => void;
  previewMode?: boolean;
  inlineMode?: boolean;
}) {
  const isCompleted = isBookingCompleted(booking);
  const mainTherapist = findTherapistByName(booking.therapist_name, therapistDirectory);
  const additionalTherapist = findTherapistByName(booking.additional_coordinator_name, therapistDirectory);
  const thirdTherapist = findTherapistByName(booking.third_coordinator_name, therapistDirectory);
  const fourthTherapist = findTherapistByName(booking.fourth_coordinator_name, therapistDirectory);
  const mainCoordinatorPhoto = mainTherapist?.photo || booking.coordinator_photo_url;
  const additionalCoordinatorPhoto =
    additionalTherapist?.photo || booking.additional_coordinator_photo_url;
  const thirdCoordinatorPhoto = thirdTherapist?.photo || booking.third_coordinator_photo_url || null;
  const fourthCoordinatorPhoto = fourthTherapist?.photo || booking.fourth_coordinator_photo_url || null;
  const mainCoordinatorRole = booking.therapist_role || mainTherapist?.profession || "";
  const additionalCoordinatorRole =
    booking.additional_coordinator_role || additionalTherapist?.profession || "";
  const thirdCoordinatorRole = booking.third_coordinator_role || thirdTherapist?.profession || "";
  const fourthCoordinatorRole = booking.fourth_coordinator_role || fourthTherapist?.profession || "";
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState<EventRegistrationFormValues>({ fullName: "", email: "", phone: "", profession: "", membershipStatus: "", comment: "" });
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const registrationRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    if (previewMode || typeof window === "undefined") return;

    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextUrl = `/events?event=${encodeURIComponent(booking.booking_date)}`;

    if (previousUrl !== nextUrl) {
      window.history.replaceState({ event: booking.booking_date }, "", nextUrl);
    }

    return () => {
      if (previousUrl !== nextUrl) {
        window.history.replaceState({}, "", previousUrl);
      }
    };
  }, [booking.booking_date, previewMode]);

  useEffect(() => {
    if (!showForm) return;

    const timeout = window.setTimeout(() => {
      registrationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [showForm]);


  useEffect(() => {
    if (!inlineMode || typeof window === "undefined") return;

    const requestParentScroll = () => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: "SEPSYG_SCROLL_TO_EMBED_TOP", source: "calendar" }, "*");
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    requestParentScroll();
    const first = window.setTimeout(requestParentScroll, 120);
    const second = window.setTimeout(requestParentScroll, 420);

    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [booking.booking_date, inlineMode]);


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


  const detailsContent = (
    <div
      className={`w-full bg-[#F7EFE8] text-[#263B39] ${inlineMode ? "sepsyg-inline-event-detail" : ""}`}
    >
      <div className="mx-auto w-full max-w-[1480px] px-3 py-3 sm:px-5 sm:py-5 lg:px-7">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[#174B49]/10 bg-white/90 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full border border-[#174B49]/15 bg-white px-4 py-2 text-sm font-extrabold text-[#174B49] hover:border-[#008D8B]/35 hover:text-[#008D8B] disabled:opacity-60"
          >
            ← Επιστροφή στις δράσεις
          </button>
          {previewMode && (
            <span className="sepsyg-preview-badge">ΠΡΟΕΠΙΣΚΟΠΗΣΗ — δεν έχει δημοσιευτεί ακόμη</span>
          )}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.45fr)] xl:gap-6">
          <aside className="space-y-4">
            {booking.image_url ? (
              <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-[24px] border border-[#174B49]/10 bg-[#EEE5DC] p-2 shadow-[0_16px_40px_rgba(23,75,73,.09)] sm:min-h-[260px] lg:min-h-0">
                <img
                  src={booking.image_url}
                  alt={booking.topic || "Δράση Συλλόγου"}
                  className="block max-h-[310px] w-full rounded-[18px] object-contain lg:max-h-[360px] xl:max-h-[390px]"
                />
              </div>
            ) : (
              <div className="h-[180px] rounded-[24px] border border-[#174B49]/10 bg-gradient-to-br from-[#9EB2A6] to-[#E1AF85] sm:h-[220px]" />
            )}

            <div className={`grid gap-2 ${booking.location ? "grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" : "grid-cols-2"}`}>
              <div className="rounded-2xl border border-[#174B49]/10 bg-white p-3.5">
                <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">📅 Ημερομηνία</span>
                <p className="mt-1.5 text-sm font-bold leading-5 text-[#263B39]">{formatDateGreek(booking.booking_date)}</p>
              </div>
              <div className="rounded-2xl border border-[#174B49]/10 bg-white p-3.5">
                <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">🕒 Ώρα</span>
                <p className="mt-1.5 text-sm font-bold leading-5 text-[#263B39]">{booking.action_time || "Θα ανακοινωθεί"}</p>
              </div>
              {booking.location && (
                <div className="rounded-2xl border border-[#174B49]/10 bg-white p-3.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#008D8B]">📍 Τοποθεσία</span>
                  <p className="mt-1.5 text-sm font-bold leading-5 text-[#263B39]">{booking.location}</p>
                </div>
              )}
            </div>

            {(activityPriceLabel(booking) || (booking.offers_member_discount && booking.member_price)) && (
              <section className={`rounded-2xl border p-4 ${activityCategoryClass(booking)} price-panel`}>
                <div className="text-[10px] font-extrabold uppercase tracking-[.13em]">Κόστος συμμετοχής</div>
                <div className="mt-1.5 flex flex-wrap items-end gap-x-4 gap-y-1">
                  {activityPriceLabel(booking) && <p className="m-0 text-xl font-extrabold">{activityPriceLabel(booking)}</p>}
                  {booking.offers_member_discount && booking.member_price && (
                    <p className="m-0 text-xs font-extrabold">Μέλη &amp; Φίλοι: {booking.member_price}</p>
                  )}
                </div>
              </section>
            )}

            {(booking.therapist_name || booking.additional_coordinator_name || booking.third_coordinator_name || booking.fourth_coordinator_name) && (
              <section className="rounded-2xl border border-[#174B49]/10 bg-white p-4">
                <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[.13em] text-[#008D8B]">Συντονίζει</p>
                <div className="space-y-2.5">
                  {booking.therapist_name && (
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#569691] text-sm font-black text-white">
                        {mainCoordinatorPhoto ? <img src={mainCoordinatorPhoto} alt={booking.therapist_name} className="h-full w-full object-cover" /> : <span>{booking.therapist_name.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-sm text-[#174B49]">{booking.therapist_name}</strong>
                        {mainCoordinatorRole && <small className="mt-0.5 block text-xs leading-4 text-[#667875]">{mainCoordinatorRole}</small>}
                      </div>
                    </div>
                  )}
                  {booking.additional_coordinator_name && (
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#9EB2A6] text-sm font-black text-white">
                        {additionalCoordinatorPhoto ? <img src={additionalCoordinatorPhoto} alt={booking.additional_coordinator_name} className="h-full w-full object-cover" /> : <span>{booking.additional_coordinator_name.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-sm text-[#174B49]">{booking.additional_coordinator_name}</strong>
                        {additionalCoordinatorRole && <small className="mt-0.5 block text-xs leading-4 text-[#667875]">{additionalCoordinatorRole}</small>}
                      </div>
                    </div>
                  )}
                  {booking.third_coordinator_name && (
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#7FA7A2] text-sm font-black text-white">
                        {thirdCoordinatorPhoto ? <img src={thirdCoordinatorPhoto} alt={booking.third_coordinator_name} className="h-full w-full object-cover" /> : <span>{booking.third_coordinator_name.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-sm text-[#174B49]">{booking.third_coordinator_name}</strong>
                        {thirdCoordinatorRole && <small className="mt-0.5 block text-xs leading-4 text-[#667875]">{thirdCoordinatorRole}</small>}
                      </div>
                    </div>
                  )}
                  {booking.fourth_coordinator_name && (
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#6E918C] text-sm font-black text-white">
                        {fourthCoordinatorPhoto ? <img src={fourthCoordinatorPhoto} alt={booking.fourth_coordinator_name} className="h-full w-full object-cover" /> : <span>{booking.fourth_coordinator_name.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-sm text-[#174B49]">{booking.fourth_coordinator_name}</strong>
                        {fourthCoordinatorRole && <small className="mt-0.5 block text-xs leading-4 text-[#667875]">{fourthCoordinatorRole}</small>}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {booking.detail_image_url && (
              <div className="grid grid-cols-[100px_1fr] items-center gap-3 rounded-2xl border border-[#174B49]/10 bg-white p-3">
                <img src={booking.detail_image_url} alt="" className="h-[92px] w-[100px] rounded-xl object-cover" />
                {previewMode ? (
                  <p className="m-0 text-xs font-bold text-[#667875]">Προεπισκόπηση δεύτερης εικόνας</p>
                ) : !isCompleted ? (
                  <button type="button" className="rounded-xl bg-[#008D8B] px-3 py-3 text-sm font-extrabold text-white" onClick={() => setShowForm(true)}>
                    Δήλωσε συμμετοχή
                  </button>
                ) : (
                  <p className="m-0 text-xs font-bold text-[#667875]">Η δράση έχει ολοκληρωθεί</p>
                )}
              </div>
            )}
          </aside>

          <main className="rounded-[26px] border border-[#174B49]/10 bg-white p-5 shadow-[0_16px_44px_rgba(23,75,73,.06)] sm:p-7 lg:p-8">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${activityCategoryClass(booking)}`}>
                {activityCategoryLabel(booking)}
              </span>
              {booking.event_type && <span className="rounded-full bg-[#174B49] px-3 py-1.5 text-xs font-bold text-white">{booking.event_type}</span>}
              {booking.mode && <span className="rounded-full bg-[#008D8B]/10 px-3 py-1.5 text-xs font-bold text-[#006B68]">{booking.mode}</span>}
            </div>

            <h1 className="mt-5 max-w-[1000px] font-serif text-[clamp(1.55rem,2.45vw,2.7rem)] font-medium leading-[1.1] text-[#174B49]">
              {booking.topic || "Δράση Συλλόγου"}
            </h1>

            {booking.description && (
              <RichTextDisplay value={booking.description} className="mt-4 max-w-[980px] text-[15px] font-medium leading-7 text-[#586A66] sm:text-base" />
            )}


            {!isCompleted && !previewMode && !showForm && (
              <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#008D8B]/20 bg-[#F0FAF8] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="block font-serif text-xl font-medium text-[#174B49]">Θέλεις να συμμετέχεις;</strong>
                  <p className="mt-1 text-xs leading-5 text-[#627472]">Η φόρμα ανοίγει εδώ, χωρίς να σε μεταφέρει σε άλλη σελίδα.</p>
                </div>
                <button type="button" onClick={() => setShowForm(true)} className="shrink-0 rounded-full bg-[#008D8B] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#006B68]">
                  Δήλωσε συμμετοχή
                </button>
              </div>
            )}

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {booking.long_description && (
                <section className="rounded-2xl border border-[#174B49]/10 bg-white p-5 xl:col-span-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Η δράση</p>
                  <h2 className="mt-1.5 font-serif text-[16px] font-semibold leading-5 text-[#174B49] sm:text-[18px]">Περισσότερες πληροφορίες</h2>
                  <RichTextDisplay value={booking.long_description} className="mt-3 text-[14px] leading-7 text-[#566966] sm:text-[15px]" />
                </section>
              )}

              {booking.audience && (
                <section className="rounded-2xl border border-[#174B49]/10 bg-[#F2F5F1] p-5">
                  <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Σε ποιους απευθύνεται</p>
                  <RichTextDisplay value={booking.audience} className="mt-2 text-[14px] leading-6 text-[#425754]" />
                </section>
              )}

              {booking.program_details && (
                <section className="rounded-2xl border border-[#174B49]/10 bg-[#FFF9F3] p-5">
                  <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#008D8B]">Πρόγραμμα / Θεματικές</p>
                  <RichTextDisplay value={booking.program_details} className="mt-2 text-[14px] leading-6 text-[#425754]" />
                </section>
              )}
            </div>

            {!previewMode && !isCompleted && showForm && (
              <form ref={registrationRef} onSubmit={handleRegistration} className="sepsyg-registration-form sepsyg-popup-registration-form mt-5">
                <div className="form-intro">
                  <h4>Δήλωση συμμετοχής</h4>
                  <p>Συμπλήρωσε τα στοιχεία σου. Η φόρμα συνδέεται αυτόματα με αυτή τη δράση.</p>
                </div>

                <div className="sepsyg-form-grid">
                  <label>Ονοματεπώνυμο *<input value={values.fullName} onChange={(event) => updateValue("fullName", event.target.value)} required maxLength={160} /></label>
                  <label>Email *<input type="email" value={values.email} onChange={(event) => updateValue("email", event.target.value)} required maxLength={220} /></label>
                  <label>Τηλέφωνο<input type="tel" value={values.phone} onChange={(event) => updateValue("phone", event.target.value)} maxLength={60} /></label>
                  <label>Επάγγελμα<input value={values.profession} onChange={(event) => updateValue("profession", event.target.value)} maxLength={160} /></label>
                </div>

                <label className="sepsyg-full-field">
                  Σχέση με τον Σύλλογο
                  <select value={values.membershipStatus} onChange={(event) => updateValue("membershipStatus", event.target.value)} required>
                    <option value="" disabled>Επίλεξε</option>
                    <option value="none">Δεν είμαι Μέλος ή Φίλος του Συλλόγου</option>
                    <option value="friend">Είμαι Φίλος του Συλλόγου</option>
                    <option value="member">Είμαι Μέλος του Συλλόγου</option>
                    <option value="want_member">Θέλω να γίνω Μέλος του Συλλόγου</option>
                  </select>
                  <small className="sepsyg-discount-note">
                    * Οι Φίλοι και τα Μέλη έχουν έκπτωση σε όλες τις δράσεις του Συλλόγου. Η έκπτωση διαμορφώνεται σε συνεννόηση με τον θεραπευτή που διοργανώνει το Σεμινάριο / Εργαστήριο.
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
          </main>
        </div>
      </div>
    </div>
  );

  if (inlineMode) {
    return <section className="min-h-screen w-full bg-[#F7EFE8]">{detailsContent}</section>;
  }

  return (
    <Modal onClose={submitting ? undefined : onClose} wide landing>
      {detailsContent}
    </Modal>
  );
}

function useCarrdEmbedBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;

    const root = document.documentElement;
    root.classList.add("sepsyg-embedded-frame");

    let raf = 0;
    let lastHeight = 0;

    const sendHeight = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const body = document.body;
        const height = Math.ceil(
          Math.max(
            body?.scrollHeight ?? 0,
            body?.offsetHeight ?? 0,
            root.scrollHeight,
            root.offsetHeight,
          ),
        );

        if (Math.abs(height - lastHeight) < 2) return;
        lastHeight = height;

        window.parent.postMessage(
          {
            type: "SEPSYG_EMBED_HEIGHT",
            source: "calendar",
            height,
          },
          "*",
        );
      });
    };

    const handleParentMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== "SEPSYG_PARENT_VIEWPORT") return;

      const visibleTop = Math.max(0, Number(data.visibleTop) || 0);
      const visibleHeight = Math.max(320, Number(data.visibleHeight) || window.innerHeight);

      root.style.setProperty("--sepsyg-embed-visible-top", `${visibleTop}px`);
      root.style.setProperty("--sepsyg-embed-visible-height", `${visibleHeight}px`);
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(sendHeight)
        : null;

    resizeObserver?.observe(root);
    if (document.body) resizeObserver?.observe(document.body);

    const mutationObserver = new MutationObserver(sendHeight);
    if (document.body) {
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    window.addEventListener("resize", sendHeight);
    window.addEventListener("load", sendHeight, true);
    window.addEventListener("message", handleParentMessage);

    window.parent.postMessage(
      { type: "SEPSYG_EMBED_READY", source: "calendar" },
      "*",
    );

    sendHeight();
    window.setTimeout(sendHeight, 80);
    window.setTimeout(sendHeight, 300);
    window.setTimeout(sendHeight, 900);

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", sendHeight);
      window.removeEventListener("load", sendHeight, true);
      window.removeEventListener("message", handleParentMessage);
      root.classList.remove("sepsyg-embedded-frame");
    };
  }, []);
}



type ArticleApprovalStatus = "pending" | "approved";
type ArticleItem = {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  cover_image_url: string;
  author_name: string;
  author_role: string;
  author_photo_url: string;
  owner_name?: string;
  approval_status: ArticleApprovalStatus;
  is_public: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function articleDateLabel(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" });
}

function ArticleReaderModal({
  article,
  preview = false,
  showShareTools = false,
  onClose,
}: {
  article: ArticleItem;
  preview?: boolean;
  showShareTools?: boolean;
  onClose: () => void;
}) {
  useModalScrollLock();
  const shareUrl = preview ? "" : articlePublicUrl(article.id);
  const [copied, setCopied] = useState(false);

  async function copyShareLink() {
    if (!shareUrl || preview) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Αντέγραψε τον σύνδεσμο:", shareUrl);
    }
  }

  return (
    <div className="sepsyg-article-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="sepsyg-article-reader" role="dialog" aria-modal="true" aria-label={article.title || "Άρθρο"}>
        <button type="button" className="sepsyg-article-close" onClick={onClose} aria-label="Κλείσιμο">×</button>
        <div className="sepsyg-article-reader-body">
          {article.cover_image_url && (
            <div className="sepsyg-article-feature-image-wrap">
              <img className="sepsyg-article-feature-image" src={article.cover_image_url} alt="" />
            </div>
          )}

          {preview && <div className="sepsyg-article-preview-badge">ΠΡΟΕΠΙΣΚΟΠΗΣΗ</div>}
          <h1>{article.title || "Τίτλος άρθρου"}</h1>
          {article.created_at && <p className="sepsyg-article-date">{articleDateLabel(article.created_at)}</p>}

          <div className="sepsyg-article-author-row">
            {article.author_photo_url ? (
              <img src={article.author_photo_url} alt={article.author_name} />
            ) : (
              <span>{article.author_name?.charAt(0) || "Σ"}</span>
            )}
            <div>
              <strong>{article.author_name}</strong>
              {article.author_role && <small>{article.author_role}</small>}
            </div>
          </div>

          {article.excerpt && <p className="sepsyg-article-lead">{article.excerpt}</p>}
          <RichTextDisplay value={article.content} className="sepsyg-article-content" />

          {!preview && showShareTools && article.is_public && (
            <div className="sepsyg-article-share-row">
              <button type="button" onClick={copyShareLink}>{copied ? "✓ Αντιγράφηκε" : "🔗 Αντιγραφή συνδέσμου άρθρου"}</button>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

function ArticlesManager({ role, memberName }: { role: ManageRole; memberName: string }) {
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [therapists, setTherapists] = useState<TherapistDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [authorName, setAuthorName] = useState(memberName);
  const [authorRole, setAuthorRole] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [authorPhotoFile, setAuthorPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [readerArticle, setReaderArticle] = useState<ArticleItem | null>(null);
  const [copiedArticleId, setCopiedArticleId] = useState<string | null>(null);
  const [editingArticle, setEditingArticle] = useState<ArticleItem | null>(null);

  const coverPreview = usePreviewFileUrl(coverFile, editingArticle?.cover_image_url || "");
  const manualAuthorPreview = usePreviewFileUrl(authorPhotoFile, editingArticle?.author_photo_url || "");
  const matchedTherapist = useMemo(() => findTherapistByName(authorName, therapists), [authorName, therapists]);
  const authorPhoto = matchedTherapist?.photo || manualAuthorPreview || "";
  const effectiveAuthorRole = authorRole.trim() || matchedTherapist?.profession || "";
  const code = getManageCode();
  const canManageArticle = (article: ArticleItem) =>
    role === "admin" || normalizeTherapistName(article.owner_name || article.author_name) === normalizeTherapistName(memberName);
  const articleDraftKey = useMemo(
    () => `sepsyg-draft-article-v1:${normalizeCommunityName(memberName || "portal") || "portal"}`,
    [memberName],
  );
  const articleDraftReadyRef = useRef(false);

  useEffect(() => {
    const draft = readLocalDraftValue<{
      title?: string;
      excerpt?: string;
      content?: string;
      authorName?: string;
      authorRole?: string;
    }>(articleDraftKey);

    if (draft) {
      setTitle(String(draft.title || ""));
      setExcerpt(String(draft.excerpt || ""));
      setContent(String(draft.content || ""));
      setAuthorName(String(draft.authorName || memberName || ""));
      setAuthorRole(String(draft.authorRole || ""));
      if (draft.title || draft.excerpt || richTextToPlainText(String(draft.content || "")).trim()) {
        setNotice("✓ Επαναφέρθηκε το προσωρινό πρόχειρο του άρθρου από αυτόν τον browser.");
      }
    }

    const timer = window.setTimeout(() => { articleDraftReadyRef.current = true; }, 0);
    return () => {
      window.clearTimeout(timer);
      articleDraftReadyRef.current = false;
    };
  }, [articleDraftKey, memberName]);

  useEffect(() => {
    if (!articleDraftReadyRef.current) return;
    writeLocalDraft(articleDraftKey, {
      title,
      excerpt,
      content,
      authorName,
      authorRole,
    });
  }, [articleDraftKey, title, excerpt, content, authorName, authorRole]);

  async function loadArticles() {
    if (!code) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/articles?code=${encodeURIComponent(code)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "ARTICLES_LOAD_FAILED");
      setArticles(Array.isArray(payload.articles) ? payload.articles : []);
      setError(null);
    } catch (caught) {
      setError(`Δεν φορτώθηκαν τα άρθρα (${(caught as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadArticles();
    void loadTherapistDirectory().then(setTherapists);
  }, []);

  const previewArticle: ArticleItem = {
    id: "preview",
    title: title.trim(),
    excerpt: excerpt.trim(),
    content: sanitizeRichHtml(content),
    cover_image_url: coverPreview,
    author_name: authorName.trim(),
    author_role: effectiveAuthorRole,
    author_photo_url: authorPhoto,
    owner_name: editingArticle?.owner_name || memberName || authorName.trim(),
    approval_status: role === "admin" ? "approved" : "pending",
    is_public: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  async function submitArticle(event: FormEvent) {
    event.preventDefault();
    if (!code) return;
    if (authorName.trim().length < 2 || title.trim().length < 3 || richTextToPlainText(content).length < 10) {
      setError("Συμπλήρωσε ονοματεπώνυμο, τίτλο και το βασικό κείμενο του άρθρου.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const cover = coverFile ? await compressImageFile(coverFile) : "";
      const manualPhoto = authorPhotoFile ? await compressImageFile(authorPhotoFile) : "";
      const response = await fetch("/api/articles", {
        method: editingArticle ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          action: editingArticle ? "update" : "create",
          id: editingArticle?.id,
          member_name: memberName,
          title: title.trim(),
          excerpt: excerpt.trim(),
          content: sanitizeRichHtml(content),
          cover_image_url: cover || editingArticle?.cover_image_url || "",
          author_name: authorName.trim(),
          author_role: effectiveAuthorRole,
          author_photo_url: matchedTherapist?.photo || manualPhoto || editingArticle?.author_photo_url || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "ARTICLE_SAVE_FAILED");

      setTitle("");
      setExcerpt("");
      setContent("");
      setCoverFile(null);
      setAuthorPhotoFile(null);
      setEditingArticle(null);
      setAuthorName(memberName);
      setAuthorRole("");
      clearLocalDraft(articleDraftKey);
      setNotice(editingArticle ? "Οι αλλαγές στο άρθρο αποθηκεύτηκαν." : role === "admin" ? "Το άρθρο δημοσιεύτηκε." : "Το άρθρο αποθηκεύτηκε και στάλθηκε για έγκριση στο Διοικητικό.");
      window.setTimeout(() => setNotice(null), 6000);
      await loadArticles();
    } catch (caught) {
      setError(`Δεν αποθηκεύτηκε το άρθρο (${(caught as Error).message}).`);
    } finally {
      setSaving(false);
    }
  }

  async function approveArticle(article: ArticleItem) {
    if (!code || role !== "admin") return;
    try {
      const response = await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, action: "approve", id: article.id, member_name: memberName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "ARTICLE_APPROVE_FAILED");
      await loadArticles();
    } catch (caught) {
      setError(`Δεν εγκρίθηκε το άρθρο (${(caught as Error).message}).`);
    }
  }

  function startEditingArticle(article: ArticleItem) {
    if (!canManageArticle(article)) return;
    setEditingArticle(article);
    setTitle(article.title);
    setExcerpt(article.excerpt || "");
    setContent(article.content || "");
    setAuthorName(article.author_name || memberName);
    setAuthorRole(article.author_role || "");
    setCoverFile(null);
    setAuthorPhotoFile(null);
    setError(null);
    setNotice("Επεξεργάζεσαι υπάρχον άρθρο.");
    window.setTimeout(() => document.querySelector(".sepsyg-article-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function cancelEditingArticle() {
    setEditingArticle(null);
    setTitle("");
    setExcerpt("");
    setContent("");
    setAuthorName(memberName);
    setAuthorRole("");
    setCoverFile(null);
    setAuthorPhotoFile(null);
    setError(null);
    setNotice(null);
  }

  async function deleteArticle(article: ArticleItem) {
    if (!code || !canManageArticle(article) || !window.confirm("Να διαγραφεί οριστικά το άρθρο;")) return;
    try {
      const response = await fetch("/api/articles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, id: article.id, member_name: memberName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "ARTICLE_DELETE_FAILED");
      await loadArticles();
    } catch (caught) {
      setError(`Δεν διαγράφηκε το άρθρο (${(caught as Error).message}).`);
    }
  }

  async function copyArticleUrl(article: ArticleItem) {
    const url = articlePublicUrl(article.id);
    if (!url || article.approval_status !== "approved") return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedArticleId(article.id);
      window.setTimeout(() => setCopiedArticleId(null), 1800);
    } catch {
      window.prompt("Αντέγραψε τον σύνδεσμο του άρθρου:", url);
    }
  }

  return (
    <div className="sepsyg-articles-manager">
      <div className="sepsyg-portal-section-head">
        <div><span>Άρθρα</span><h2>{editingArticle ? "Επεξεργασία άρθρου" : "Νέο άρθρο θεραπευτή"}</h2></div>
        <p>Γράψε το άρθρο, δες προεπισκόπηση και αποθήκευσέ το. Η φωτογραφία και η ιδιότητα συμπληρώνονται αυτόματα όταν το ονοματεπώνυμο υπάρχει στον Χάρτη Θεραπευτών.</p>
      </div>

      {notice && <div className="sepsyg-portal-notice success">{notice}</div>}
      {error && <div className="sepsyg-portal-notice error">{error}</div>}

      <form className="sepsyg-article-form" onSubmit={submitArticle}>
        <div className="sepsyg-article-form-grid">
          <div>
            <label htmlFor="article-author">Ονοματεπώνυμο</label>
            <input id="article-author" value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Ονοματεπώνυμο θεραπευτή" required />
            {matchedTherapist && <small className="sepsyg-match-note">✓ Βρέθηκε στον Χάρτη Θεραπευτών — φωτογραφία και ιδιότητα συνδέθηκαν αυτόματα.</small>}
          </div>
          <div>
            <label htmlFor="article-role">Ιδιότητα / επάγγελμα</label>
            <input id="article-role" value={authorRole} onChange={(e) => setAuthorRole(e.target.value)} placeholder={matchedTherapist?.profession || "π.χ. Σύμβουλος Ψυχικής Υγείας"} />
          </div>
        </div>

        <div className="sepsyg-article-author-preview">
          {authorPhoto ? <img src={authorPhoto} alt="" /> : <span>{authorName.charAt(0) || "Θ"}</span>}
          <div><strong>{authorName || "Ονοματεπώνυμο"}</strong><small>{effectiveAuthorRole || "Ιδιότητα"}</small></div>
        </div>

        {!matchedTherapist?.photo && (
          <div>
            <label htmlFor="article-author-photo">Φωτογραφία συγγραφέα <span>(μόνο αν δεν υπάρχει ήδη στον χάρτη)</span></label>
            <input id="article-author-photo" type="file" accept="image/*" onChange={(e) => setAuthorPhotoFile(e.target.files?.[0] || null)} />
          </div>
        )}

        <div>
          <label htmlFor="article-title">Τίτλος άρθρου</label>
          <input id="article-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ένας καθαρός, ενδιαφέρων τίτλος" required />
        </div>
        <div>
          <label htmlFor="article-excerpt">Σύντομη εισαγωγή</label>
          <textarea id="article-excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="2–3 προτάσεις που θα φαίνονται στην κάρτα του άρθρου." />
        </div>
        <div>
          <label htmlFor="article-cover">Κεντρική φωτογραφία άρθρου</label>
          <input id="article-cover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label>Κείμενο άρθρου</label>
          <RichTextEditor id="article-content" value={content} onChange={setContent} placeholder="Γράψε εδώ το άρθρο. Μπορείς να χρησιμοποιήσεις bold, υπογράμμιση, χρώμα και emoji." />
        </div>

        <div className="sepsyg-article-form-actions">
          <button type="button" className="secondary" onClick={() => setPreviewOpen(true)}>👁 Προεπισκόπηση</button>
          {editingArticle && <button type="button" className="secondary" onClick={cancelEditingArticle} disabled={saving}>Ακύρωση επεξεργασίας</button>}
          <button type="submit" disabled={saving}>{saving ? "Αποθήκευση…" : editingArticle ? "Αποθήκευση αλλαγών" : role === "admin" ? "Δημοσίευση άρθρου" : "Υποβολή άρθρου"}</button>
        </div>
      </form>

      <section className="sepsyg-article-list-panel">
        <div className="sepsyg-portal-section-head compact"><div><span>Καταχωρίσεις</span><h2>Άρθρα</h2></div></div>
        {loading ? <p>Φόρτωση…</p> : articles.length === 0 ? <p>Δεν υπάρχουν ακόμη άρθρα.</p> : (
          <div className="sepsyg-article-admin-list">
            {articles.map((article) => (
              <div className="sepsyg-article-admin-item" key={article.id}>
                <div className="sepsyg-article-admin-copy">
                  <strong>{article.title}</strong>
                  <small>{article.author_name} · {article.approval_status === "approved" ? "Δημοσιευμένο" : "Αναμονή έγκρισης"}</small>
                  {article.approval_status === "approved" && canManageArticle(article) ? (
                    <div className="sepsyg-article-public-url">
                      <code>{articlePublicUrl(article.id)}</code>
                      <button type="button" onClick={() => copyArticleUrl(article)}>{copiedArticleId === article.id ? "✓ Αντιγράφηκε" : "Αντιγραφή URL"}</button>
                    </div>
                  ) : article.approval_status !== "approved" && canManageArticle(article) ? (
                    <small className="sepsyg-url-pending">Το ξεχωριστό URL δημιουργείται μόλις εγκριθεί το άρθρο.</small>
                  ) : null}
                </div>
                <div>
                  <button type="button" onClick={() => setReaderArticle(article)}>Προβολή</button>
                  {canManageArticle(article) && <button type="button" onClick={() => startEditingArticle(article)}>Επεξεργασία</button>}
                  {role === "admin" && article.approval_status !== "approved" && <button type="button" onClick={() => approveArticle(article)}>Έγκριση</button>}
                  {canManageArticle(article) && <button type="button" className="danger" onClick={() => deleteArticle(article)}>Διαγραφή</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {previewOpen && <ArticleReaderModal article={previewArticle} preview onClose={() => setPreviewOpen(false)} />}
      {readerArticle && (
        <ArticleReaderModal
          article={readerArticle}
          showShareTools={canManageArticle(readerArticle)}
          onClose={() => setReaderArticle(null)}
        />
      )}
    </div>
  );
}

function PublicArticlesApp({ embedOnly = false }: { embedOnly?: boolean }) {
  const articleHeroDefaults = WEBSITE_SECTION_DEFINITIONS.find((item) => item.key === "articles")?.defaults || {};
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [articleHero, setArticleHero] = useState<Record<string, string>>({ ...articleHeroDefaults });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ArticleItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPublicArticles(firstLoad = false) {
      try {
        if (firstLoad) setLoading(true);
        const response = await fetch(`/api/articles?_=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.code || "ARTICLES_LOAD_FAILED");
        if (cancelled) return;

        const items = Array.isArray(payload.articles) ? payload.articles : [];
        setArticles(items);
        setError(null);

        const requested = new URLSearchParams(window.location.search).get("article");
        if (requested) {
          setSelected(items.find((item: ArticleItem) => item.id === requested) || null);
        }
      } catch (caught) {
        if (!cancelled) setError(`Δεν φορτώθηκαν τα άρθρα (${(caught as Error).message}).`);
      } finally {
        if (!cancelled && firstLoad) setLoading(false);
      }
    }

    void loadPublicArticles(true);

    const refresh = () => void loadPublicArticles(false);
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadArticleHero() {
      try {
        const response = await fetch(`/api/site-content?section=articles&_=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const fields = payload?.section?.fields && typeof payload.section.fields === "object" ? payload.section.fields : {};
        setArticleHero({ ...articleHeroDefaults, ...fields });
      } catch {
        // Κρατάμε τα υπάρχοντα defaults αν το CMS δεν έχει ακόμη δημοσιευμένο περιεχόμενο.
      }
    }

    void loadArticleHero();
    const timer = window.setInterval(loadArticleHero, 30000);
    window.addEventListener("focus", loadArticleHero);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", loadArticleHero);
    };
  }, []);

  const routeBase = embedOnly ? "/articles-embed" : "/articles";

  function openArticle(article: ArticleItem) {
    setSelected(article);
    window.history.replaceState({}, "", `${routeBase}?article=${encodeURIComponent(article.id)}`);
  }

  function closeArticle() {
    setSelected(null);
    window.history.replaceState({}, "", routeBase);
  }

  return (
    <div className={`sepsyg-public-articles-page${embedOnly ? " embed-only" : ""}`}>
      {embedOnly ? (
        <header className="sepsyg-articles-embed-hero">
          <div className="sepsyg-articles-embed-copy">
            <span>{articleHero.eyebrow || "Γνώση · Εμπειρία · Εφαρμογή"}</span>
            <h1>{articleHero.title || "Άρθρα"}</h1>
            <p>{articleHero.intro || "Κείμενα για την ανθρώπινη επαφή, την επικοινωνία, τη θεραπευτική σχέση και τη Σωματικά Επικεντρωμένη Ψυχοθεραπεία Gestalt."}</p>
          </div>

          <div className="sepsyg-articles-embed-video">
            <video autoPlay muted loop playsInline preload="metadata">
              {articleHero.video_url && <source src={articleHero.video_url} type="video/mp4" />}
            </video>
            <span>{articleHero.video_badge || "Άρθρα & Προσεγγίσεις"}</span>
          </div>
        </header>
      ) : (
        <header className="sepsyg-articles-public-hero">
          <AssociationLogo size="sm" />
          <span>Πανευρωπαϊκός Επιστημονικός Σύλλογος Σ.Ε.ΨΥ.G.</span>
          <h1>Άρθρα Θεραπευτών</h1>
          <p>Άρθρα και εκπαιδευτικό περιεχόμενο από θεραπευτές του Συλλόγου.</p>
        </header>
      )}
      <main className="sepsyg-public-articles-wrap">
        {error && <div className="sepsyg-portal-notice error">{error}</div>}
        {loading ? <p>Φόρτωση…</p> : articles.length === 0 ? (
          <div className="sepsyg-public-articles-empty">Δεν υπάρχουν ακόμη δημοσιευμένα άρθρα.</div>
        ) : (
          <div className="sepsyg-public-article-grid">
            {articles.map((article) => (
              <button type="button" className="sepsyg-public-article-card" key={article.id} onClick={() => openArticle(article)}>
                {article.cover_image_url && <img className="cover" src={article.cover_image_url} alt="" />}
                <div className="body">
                  <div className="author">
                    {article.author_photo_url ? <img src={article.author_photo_url} alt="" /> : <span>{article.author_name.charAt(0)}</span>}
                    <div><strong>{article.author_name}</strong><small>{article.author_role}</small></div>
                  </div>
                  <h2>{article.title}</h2>
                  {article.excerpt && <p>{article.excerpt}</p>}
                  <span className="read-more">Διάβασε το άρθρο →</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
      {selected && <ArticleReaderModal article={selected} onClose={closeArticle} />}
    </div>
  );
}

function PublicSingleArticleApp({ articleId }: { articleId: string }) {
  const [article, setArticle] = useState<ArticleItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/articles")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.code || "ARTICLES_LOAD_FAILED");
        const items = Array.isArray(payload.articles) ? payload.articles : [];
        const found = items.find((item: ArticleItem) => item.id === articleId) || null;
        setArticle(found);
        if (!found) setError("Το άρθρο δεν βρέθηκε ή δεν είναι ακόμη δημοσιευμένο.");
      })
      .catch((caught) => setError(`Δεν φορτώθηκε το άρθρο (${(caught as Error).message}).`))
      .finally(() => setLoading(false));
  }, [articleId]);

  if (loading) return <div className="sepsyg-single-article-state">Φόρτωση άρθρου…</div>;
  if (!article) return <div className="sepsyg-single-article-state"><strong>{error || "Το άρθρο δεν βρέθηκε."}</strong><a href="/articles">Επιστροφή στα άρθρα</a></div>;

  return (
    <div className="sepsyg-single-article-page">
      <ArticleReaderModal article={article} onClose={() => { window.location.href = "/articles"; }} />
    </div>
  );
}



type NewsletterSubscriber = {
  id: string;
  email: string;
  active: boolean;
  source: string;
  consent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function downloadCsvFile(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => quote(String(cell ?? ""))).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function AllEventRegistrationsManager() {
  const [items, setItems] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    const code = getManageCode();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-registrations?all=1&code=${encodeURIComponent(code)}&_=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "REGISTRATIONS_LOAD_FAILED");
      setItems(Array.isArray(payload.registrations) ? payload.registrations : []);
    } catch (caught) {
      setError(`Δεν φορτώθηκαν οι συγκεντρωτικές συμμετοχές (${(caught as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("el-GR");
    if (!needle) return items;
    return items.filter((item) => [item.full_name, item.email, item.phone, item.profession, item.event_topic, item.event_date]
      .join(" ").toLocaleLowerCase("el-GR").includes(needle));
  }, [items, query]);

  const eventCount = useMemo(() => new Set(items.map((item) => item.event_id || item.event_date).filter(Boolean)).size, [items]);

  function exportCsv() {
    downloadCsvFile("symmetoxes-olon-ton-draseon.csv", [
      ["Ημερομηνία δράσης", "Δράση", "Ώρα", "Ονοματεπώνυμο", "Email", "Τηλέφωνο", "Επάγγελμα", "Σχέση με Σύλλογο", "Σχόλιο", "Υποβολή"],
      ...items.map((item) => [
        item.event_date || item.event_id,
        item.event_topic,
        item.event_time,
        item.full_name,
        item.email,
        item.phone,
        item.profession,
        item.membership_status,
        item.comment,
        item.created_at ? new Date(item.created_at).toLocaleString("el-GR") : "",
      ]),
    ]);
  }

  return (
    <section className="sepsyg-admin-panel sepsyg-admin-registrations-panel">
      <div className="sepsyg-admin-panel-head">
        <div><span>Συμμετοχές</span><h3>Όλες οι δράσεις συγκεντρωτικά</h3></div>
        <div className="sepsyg-admin-head-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>Ανανέωση</button>
          <button type="button" onClick={exportCsv} disabled={!items.length}>Εξαγωγή CSV</button>
        </div>
      </div>

      <div className="sepsyg-admin-summary-cards">
        <div><strong>{items.length}</strong><span>συνολικές συμμετοχές</span></div>
        <div><strong>{eventCount}</strong><span>δράσεις με συμμετοχές</span></div>
      </div>

      <label className="sepsyg-admin-search-field">
        <span>Αναζήτηση</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Όνομα, email, δράση, επάγγελμα…" />
      </label>

      {loading && <p className="sepsyg-admin-inline-state">Φόρτωση συμμετοχών…</p>}
      {error && <div className="sepsyg-admin-error">{error}</div>}
      {!loading && !error && !filtered.length && <p className="sepsyg-admin-inline-state">Δεν υπάρχουν συμμετοχές που να ταιριάζουν.</p>}

      {!loading && filtered.length > 0 && (
        <div className="sepsyg-admin-data-table-wrap">
          <table className="sepsyg-admin-data-table">
            <thead><tr><th>Δράση</th><th>Συμμετέχων</th><th>Επικοινωνία</th><th>Επάγγελμα</th><th>Σχέση</th></tr></thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.event_topic || "Δράση Συλλόγου"}</strong><span>{item.event_date ? formatDateGreek(item.event_date) : item.event_id}</span></td>
                  <td><strong>{item.full_name}</strong>{item.created_at && <span>{new Date(item.created_at).toLocaleString("el-GR")}</span>}</td>
                  <td><a href={`mailto:${item.email}`}>{item.email}</a><a href={`tel:${item.phone}`}>{item.phone}</a></td>
                  <td>{item.profession || "—"}</td>
                  <td>{item.membership_status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NewsletterSubscribersManager() {
  const [items, setItems] = useState<NewsletterSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const code = getManageCode();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/newsletter-signup?code=${encodeURIComponent(code)}&_=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "NEWSLETTER_LOAD_FAILED");
      setItems(Array.isArray(payload.subscribers) ? payload.subscribers : []);
    } catch (caught) {
      setError(`Δεν φορτώθηκε η λίστα newsletter (${(caught as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function exportCsv() {
    downloadCsvFile("newsletter-sepsyg.csv", [
      ["Email", "Πηγή", "Ημερομηνία συγκατάθεσης", "Ημερομηνία εγγραφής"],
      ...items.map((item) => [
        item.email,
        item.source,
        item.consent_at ? new Date(item.consent_at).toLocaleString("el-GR") : "",
        item.created_at ? new Date(item.created_at).toLocaleString("el-GR") : "",
      ]),
    ]);
  }

  return (
    <section className="sepsyg-admin-panel sepsyg-admin-newsletter-panel">
      <div className="sepsyg-admin-panel-head">
        <div><span>Newsletter</span><h3>Εγγραφές ενημέρωσης</h3></div>
        <div className="sepsyg-admin-head-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>Ανανέωση</button>
          <button type="button" onClick={exportCsv} disabled={!items.length}>Εξαγωγή CSV</button>
        </div>
      </div>
      <div className="sepsyg-admin-summary-cards single"><div><strong>{items.length}</strong><span>ενεργές εγγραφές</span></div></div>
      {loading && <p className="sepsyg-admin-inline-state">Φόρτωση newsletter…</p>}
      {error && <div className="sepsyg-admin-error">{error}</div>}
      {!loading && !error && !items.length && <p className="sepsyg-admin-inline-state">Δεν υπάρχει ακόμη εγγραφή.</p>}
      {!loading && items.length > 0 && (
        <div className="sepsyg-admin-newsletter-list">
          {items.map((item) => <div key={item.id}><a href={`mailto:${item.email}`}>{item.email}</a><span>{item.created_at ? new Date(item.created_at).toLocaleDateString("el-GR") : "—"}</span></div>)}
        </div>
      )}
    </section>
  );
}

function AdministrationManager() {
  const [boardRemote, setBoardRemote] = useState<BoardTermAdmin[]>([]);
  const [communityRemote, setCommunityRemote] = useState<Array<{ id: string; name: string; type: CommunityKind; hidden: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardEditing, setBoardEditing] = useState<BoardTermAdmin | "new" | null>(null);
  const [boardForm, setBoardForm] = useState({ from_year: 2026, to_year: 2028, president: "", vice_president: "", secretary: "", treasurer: "", member: "" });
  const [personEditing, setPersonEditing] = useState<CommunityPersonAdmin | "new" | null>(null);
  const [personName, setPersonName] = useState("");
  const [personType, setPersonType] = useState<CommunityKind>("member");
  const [saving, setSaving] = useState(false);
  const boardBaselineRef = useRef("");
  const personBaselineRef = useRef("");

  useEffect(() => {
    if (!boardEditing) return;
    writeLocalDraft(`sepsyg-draft-board-v1:${boardEditing === "new" ? "new" : boardEditing.id}`, boardForm);
  }, [boardEditing, boardForm]);

  useEffect(() => {
    if (!personEditing) return;
    writeLocalDraft(`sepsyg-draft-community-v1:${personEditing === "new" ? "new" : personEditing.id}`, {
      name: personName,
      type: personType,
    });
  }, [personEditing, personName, personType]);

  useEffect(() => {
    let stopBoard: (() => void) | undefined;
    let stopCommunity: (() => void) | undefined;
    let cancelled = false;

    ensureAssociationAnonymousUser()
      .then(() => {
        if (cancelled) return;
        stopBoard = onSnapshot(
          collection(associationDb, "association_board"),
          (snapshot) => {
            const items = snapshot.docs.map((entry) => {
              const data = entry.data() as Record<string, unknown>;
              return {
                id: entry.id,
                from_year: Number(data.from_year || 0),
                to_year: Number(data.to_year || 0),
                president: String(data.president || ""),
                vice_president: String(data.vice_president || ""),
                secretary: String(data.secretary || ""),
                treasurer: String(data.treasurer || ""),
                member: String(data.member || ""),
                hidden: data.hidden === true,
              } satisfies BoardTermAdmin;
            });
            setBoardRemote(items);
            setLoading(false);
            setError(null);
          },
          (caught) => {
            console.error(caught);
            setError("Δεν φορτώθηκε το Διοικητικό Συμβούλιο από τη βάση.");
            setLoading(false);
          },
        );
        stopCommunity = onSnapshot(
          collection(associationDb, "association_members"),
          (snapshot) => {
            const items = snapshot.docs.map((entry) => {
              const data = entry.data() as Record<string, unknown>;
              return {
                id: entry.id,
                name: String(data.name || "").trim(),
                type: data.type === "friend" ? "friend" as const : "member" as const,
                hidden: data.hidden === true,
              };
            }).filter((item) => item.name);
            setCommunityRemote(items);
            setLoading(false);
            setError(null);
          },
          (caught) => {
            console.error(caught);
            setError("Δεν φορτώθηκαν τα Μέλη & Φίλοι από τη βάση.");
            setLoading(false);
          },
        );
      })
      .catch((caught) => {
        console.error(caught);
        setError("Δεν ήταν δυνατή η σύνδεση με τη βάση του Συλλόγου.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stopBoard?.();
      stopCommunity?.();
    };
  }, []);

  const boardTerms = useMemo(() => {
    const map = new Map<string, BoardTermAdmin>();
    STATIC_BOARD_TERMS.forEach((item) => map.set(item.id, { ...item }));
    boardRemote.forEach((item) => {
      if (item.hidden) {
        map.delete(item.id);
        return;
      }
      const previous = map.get(item.id);
      map.set(item.id, { ...(previous || {} as BoardTermAdmin), ...item, isStatic: previous?.isStatic === true });
    });
    return Array.from(map.values()).sort((a, b) => b.from_year - a.from_year);
  }, [boardRemote]);

  const community = useMemo(() => {
    const map = new Map<string, CommunityPersonAdmin>();
    const hiddenKeys = new Set<string>();
    STATIC_ASSOCIATION_MEMBERS.forEach((name) => {
      const key = `member|${normalizeCommunityName(name)}`;
      map.set(key, { id: `static-${key}`, name, type: "member", source: "static" });
    });
    communityRemote.forEach((item) => {
      const key = `${item.type}|${normalizeCommunityName(item.name)}`;
      if (item.hidden) hiddenKeys.add(key);
    });
    communityRemote.forEach((item) => {
      const key = `${item.type}|${normalizeCommunityName(item.name)}`;
      if (item.hidden || hiddenKeys.has(key)) return;
      map.set(key, { id: item.id, name: item.name, type: item.type, source: "remote" });
    });
    hiddenKeys.forEach((key) => map.delete(key));
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "el"));
  }, [communityRemote]);

  const members = community.filter((item) => item.type === "member");
  const friends = community.filter((item) => item.type === "friend");

  function openBoard(item?: BoardTermAdmin) {
    const target = item || "new";
    const base = item
      ? {
          from_year: item.from_year,
          to_year: item.to_year,
          president: item.president,
          vice_president: item.vice_president,
          secretary: item.secretary,
          treasurer: item.treasurer,
          member: item.member,
        }
      : { from_year: 2026, to_year: 2028, president: "", vice_president: "", secretary: "", treasurer: "", member: "" };

    boardBaselineRef.current = JSON.stringify(base);
    const key = `sepsyg-draft-board-v1:${target === "new" ? "new" : target.id}`;
    const draft = readLocalDraftValue<typeof base>(key);
    setBoardForm(draft ? { ...base, ...draft } : base);
    setBoardEditing(target);
  }

  function closeBoardEditorSafely() {
    if (saving) return;
    const changed = JSON.stringify(boardForm) !== boardBaselineRef.current;
    if (changed && !window.confirm("Υπάρχουν μη αποθηκευμένες αλλαγές. Έχουν κρατηθεί προσωρινά σε αυτόν τον browser. Θέλεις να βγεις;")) return;
    setBoardEditing(null);
  }

  async function saveBoard(event: FormEvent) {
    event.preventDefault();
    if (boardForm.to_year < boardForm.from_year) {
      setError("Το έτος λήξης δεν μπορεί να είναι πριν από το έτος έναρξης.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await ensureAssociationAnonymousUser();
      const id = boardEditing && boardEditing !== "new" ? boardEditing.id : `custom-${Date.now()}`;
      await setDoc(doc(associationDb, "association_board", id), { ...boardForm, hidden: false, updated_at: serverTimestamp() }, { merge: true });
      clearLocalDraft(`sepsyg-draft-board-v1:${boardEditing === "new" ? "new" : boardEditing?.id || "new"}`);
      setBoardEditing(null);
    } catch (caught) {
      console.error(caught);
      setError("Δεν αποθηκεύτηκε η θητεία του Διοικητικού Συμβουλίου.");
    } finally {
      setSaving(false);
    }
  }

  async function removeBoard(item: BoardTermAdmin) {
    if (!window.confirm(`Να αφαιρεθεί η θητεία ${item.from_year}–${item.to_year};`)) return;
    setError(null);
    try {
      await ensureAssociationAnonymousUser();
      await setDoc(
        doc(associationDb, "association_board", item.id),
        { hidden: true, updated_at: serverTimestamp() },
        { merge: true },
      );
    } catch (caught) {
      console.error(caught);
      setError("Δεν αφαιρέθηκε η θητεία.");
    }
  }

  function openPerson(item?: CommunityPersonAdmin) {
    const target = item || "new";
    const base = item ? { name: item.name, type: item.type } : { name: "", type: "member" as CommunityKind };
    personBaselineRef.current = JSON.stringify(base);
    const key = `sepsyg-draft-community-v1:${target === "new" ? "new" : target.id}`;
    const draft = readLocalDraftValue<{ name?: string; type?: CommunityKind }>(key);
    setPersonName(typeof draft?.name === "string" ? draft.name : base.name);
    setPersonType(draft?.type === "friend" ? "friend" : base.type);
    setPersonEditing(target);
  }

  function closePersonEditorSafely() {
    if (saving) return;
    const changed = JSON.stringify({ name: personName, type: personType }) !== personBaselineRef.current;
    if (changed && !window.confirm("Υπάρχουν μη αποθηκευμένες αλλαγές. Έχουν κρατηθεί προσωρινά σε αυτόν τον browser. Θέλεις να βγεις;")) return;
    setPersonEditing(null);
  }

  async function hideStaticCommunity(name: string, type: CommunityKind) {
    await setDoc(
      doc(associationDb, "association_members", communityControlId(name, type)),
      { name, type, hidden: true, updated_at: serverTimestamp() },
      { merge: true },
    );
  }

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    const nextName = personName.trim();
    if (nextName.length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await ensureAssociationAnonymousUser();
      if (personEditing && personEditing !== "new") {
        if (personEditing.source === "static") {
          const oldKey = `${personEditing.type}|${normalizeCommunityName(personEditing.name)}`;
          const newKey = `${personType}|${normalizeCommunityName(nextName)}`;
          if (oldKey === newKey) {
            await setDoc(
              doc(associationDb, "association_members", communityControlId(personEditing.name, personEditing.type)),
              { name: nextName, type: personType, hidden: false, updated_at: serverTimestamp() },
              { merge: true },
            );
          } else {
            await hideStaticCommunity(personEditing.name, personEditing.type);
            await addDoc(collection(associationDb, "association_members"), { name: nextName, type: personType, hidden: false, created_at: serverTimestamp(), updated_at: serverTimestamp() });
          }
        } else {
          await updateDoc(doc(associationDb, "association_members", personEditing.id), { name: nextName, type: personType, hidden: false, updated_at: serverTimestamp() });
        }
      } else {
        await addDoc(collection(associationDb, "association_members"), { name: nextName, type: personType, hidden: false, created_at: serverTimestamp(), updated_at: serverTimestamp() });
      }
      clearLocalDraft(`sepsyg-draft-community-v1:${personEditing === "new" ? "new" : personEditing?.id || "new"}`);
      setPersonEditing(null);
      setPersonName("");
    } catch (caught) {
      console.error(caught);
      setError("Δεν αποθηκεύτηκε το μέλος/ο φίλος.");
    } finally {
      setSaving(false);
    }
  }

  async function removePerson(item: CommunityPersonAdmin) {
    if (!window.confirm(`Να αφαιρεθεί ο/η ${item.name};`)) return;
    setError(null);
    try {
      await ensureAssociationAnonymousUser();
      const existsInStatic = item.type === "member" && STATIC_ASSOCIATION_MEMBERS.some((name) => normalizeCommunityName(name) === normalizeCommunityName(item.name));
      if (item.source === "static") {
        await hideStaticCommunity(item.name, item.type);
      } else {
        await setDoc(
          doc(associationDb, "association_members", item.id),
          { name: item.name, type: item.type, hidden: true, updated_at: serverTimestamp() },
          { merge: true },
        );
        if (existsInStatic) await hideStaticCommunity(item.name, item.type);
      }
    } catch (caught) {
      console.error(caught);
      setError("Δεν αφαιρέθηκε το μέλος/ο φίλος.");
    }
  }

  return (
    <div className="sepsyg-admin-content">
      <div className="sepsyg-admin-intro">
        <span>Μόνο Διοικητικό</span>
        <h2>Διοίκηση Συλλόγου</h2>
        <p>Εδώ διαχειρίζεσαι το Διοικητικό Συμβούλιο, τα Μέλη & Φίλους, τις συγκεντρωτικές συμμετοχές από όλες τις δράσεις και τις εγγραφές newsletter. Για τα κείμενα, τις εικόνες και το logo της ιστοσελίδας χρησιμοποίησε την καρτέλα «Επεξεργασία ιστοσελίδας».</p>
      </div>
      {error && <div className="sepsyg-admin-error">{error}</div>}
      {loading && <div className="sepsyg-admin-loading">Φόρτωση στοιχείων…</div>}

      <section className="sepsyg-admin-panel">
        <div className="sepsyg-admin-panel-head"><div><span>Διοίκηση</span><h3>Διοικητικό Συμβούλιο</h3></div><button type="button" onClick={() => openBoard()}>+ Νέα θητεία</button></div>
        <div className="sepsyg-board-admin-grid">
          {boardTerms.map((item) => (
            <article key={item.id} className="sepsyg-board-admin-card">
              <div className="sepsyg-board-admin-year">{item.from_year}–{item.to_year}</div>
              <p><strong>Πρόεδρος</strong>{item.president || "—"}</p>
              <p><strong>Αντιπρόεδρος</strong>{item.vice_president || "—"}</p>
              <p><strong>Γραμματέας</strong>{item.secretary || "—"}</p>
              <p><strong>Ταμίας</strong>{item.treasurer || "—"}</p>
              <p><strong>Μέλος</strong>{item.member || "—"}</p>
              <div className="sepsyg-admin-actions"><button type="button" onClick={() => openBoard(item)}>Επεξεργασία</button><button type="button" className="danger" onClick={() => void removeBoard(item)}>Αφαίρεση</button></div>
            </article>
          ))}
        </div>
      </section>

      <section className="sepsyg-admin-panel">
        <div className="sepsyg-admin-panel-head"><div><span>Κοινότητα</span><h3>Μέλη &amp; Φίλοι</h3></div><button type="button" onClick={() => openPerson()}>+ Προσθήκη</button></div>
        <div className="sepsyg-community-admin-columns">
          <div><div className="sepsyg-community-title"><h4>Μέλη Συλλόγου</h4><span>{members.length}</span></div><div className="sepsyg-community-list">{members.map((item) => <div key={`${item.type}-${item.id}-${item.name}`}><span>{item.name}</span><div><button type="button" onClick={() => openPerson(item)}>Επεξεργασία</button><button type="button" className="danger" onClick={() => void removePerson(item)}>×</button></div></div>)}</div></div>
          <div><div className="sepsyg-community-title"><h4>Φίλοι Συλλόγου</h4><span>{friends.length}</span></div><div className="sepsyg-community-list">{friends.length ? friends.map((item) => <div key={`${item.type}-${item.id}-${item.name}`}><span>{item.name}</span><div><button type="button" onClick={() => openPerson(item)}>Επεξεργασία</button><button type="button" className="danger" onClick={() => void removePerson(item)}>×</button></div></div>) : <p className="sepsyg-community-empty">Δεν υπάρχουν ακόμη καταχωρισμένοι φίλοι.</p>}</div></div>
        </div>
      </section>

      <AllEventRegistrationsManager />
      <NewsletterSubscribersManager />

      {boardEditing && (
        <div className="sepsyg-admin-modal">
          <form className="sepsyg-admin-modal-card" onSubmit={saveBoard}>
            <span>Διοικητικό Συμβούλιο</span><h3>{boardEditing === "new" ? "Νέα θητεία" : "Επεξεργασία θητείας"}</h3>
            <div className="sepsyg-admin-years"><label>Από έτος<input type="number" min="2020" max="2050" value={boardForm.from_year} onChange={(e) => setBoardForm((v) => ({ ...v, from_year: Number(e.target.value) }))} /></label><label>Έως έτος<input type="number" min="2020" max="2050" value={boardForm.to_year} onChange={(e) => setBoardForm((v) => ({ ...v, to_year: Number(e.target.value) }))} /></label></div>
            <label>Πρόεδρος<input value={boardForm.president} onChange={(e) => setBoardForm((v) => ({ ...v, president: e.target.value }))} /></label>
            <label>Αντιπρόεδρος<input value={boardForm.vice_president} onChange={(e) => setBoardForm((v) => ({ ...v, vice_president: e.target.value }))} /></label>
            <label>Γραμματέας<input value={boardForm.secretary} onChange={(e) => setBoardForm((v) => ({ ...v, secretary: e.target.value }))} /></label>
            <label>Ταμίας<input value={boardForm.treasurer} onChange={(e) => setBoardForm((v) => ({ ...v, treasurer: e.target.value }))} /></label>
            <label>Μέλος<input value={boardForm.member} onChange={(e) => setBoardForm((v) => ({ ...v, member: e.target.value }))} /></label>
            <div className="sepsyg-admin-modal-actions">
              <button type="button" className="sepsyg-admin-exit" onClick={closeBoardEditorSafely} disabled={saving}>Έξοδος</button>
              <button type="submit" className="sepsyg-admin-save" disabled={saving}>{saving ? "Αποθήκευση…" : "Αποθήκευση"}</button>
            </div>
          </form>
        </div>
      )}

      {personEditing && (
        <div className="sepsyg-admin-modal">
          <form className="sepsyg-admin-modal-card small" onSubmit={savePerson}>
            <span>Κοινότητα Συλλόγου</span><h3>{personEditing === "new" ? "Νέα καταχώριση" : "Επεξεργασία"}</h3>
            <label>Ονοματεπώνυμο<input value={personName} onChange={(e) => setPersonName(e.target.value)} autoFocus required /></label>
            <label>Κατηγορία<select value={personType} onChange={(e) => setPersonType(e.target.value as CommunityKind)}><option value="member">Μέλος Συλλόγου</option><option value="friend">Φίλος Συλλόγου</option></select></label>
            <div className="sepsyg-admin-modal-actions">
              <button type="button" className="sepsyg-admin-exit" onClick={closePersonEditorSafely} disabled={saving}>Έξοδος</button>
              <button type="submit" className="sepsyg-admin-save" disabled={saving}>{saving ? "Αποθήκευση…" : "Αποθήκευση"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


function formatSiteContentTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" });
}


function normalizeEditorColor(value: string, fallback = "#174B49") {
  const trimmed = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}


function GenericWebsitePreview({ definition, fields }: { definition: WebsiteSectionDefinition; fields: Record<string, string> }) {
  const contentFields = definition.fields.filter((field) => (field.group || "content") === "content");
  const textFields = contentFields.filter((field) => ["text", "textarea"].includes(field.kind) && fields[field.key]);
  const imageFields = contentFields.filter((field) => field.kind === "image" && fields[field.key]).slice(0, 3);
  const linkFields = contentFields.filter((field) => field.kind === "url" && fields[field.key]).slice(0, 3);

  const headingColor = fields.style_heading_color || "#174B49";
  const bodyColor = fields.style_body_color || "#627472";
  const accentColor = fields.style_accent_color || "#008D8B";
  const borderColor = fields.style_border_color || "#DDE4E2";
  const sectionBackground = fields.style_section_background || "#FFF9F3";
  const cardBackground = fields.style_card_background || "#FFFFFF";
  const headingFont = fields.style_heading_font || 'Georgia, "Times New Roman", serif';
  const bodyFont = fields.style_body_font || "Arial, Helvetica, sans-serif";

  const previewStyle: CSSProperties = {
    background: sectionBackground,
    color: bodyColor,
    fontFamily: bodyFont,
    padding: "clamp(18px, 3vw, 34px)",
    border: `1px solid ${borderColor}`,
    borderRadius: fields.style_card_radius || "12px",
  };
  const cardStyle: CSSProperties = {
    background: cardBackground,
    border: `1px solid ${borderColor}`,
    borderRadius: fields.style_card_radius || "12px",
    boxShadow: fields.style_card_shadow || "none",
    padding: "clamp(16px, 2.5vw, 28px)",
  };
  const headingStyle: CSSProperties = {
    color: headingColor,
    fontFamily: headingFont,
    fontSize: fields.style_title_size || "clamp(1.45rem, 3vw, 2.25rem)",
    lineHeight: 1.12,
    fontWeight: 500,
    margin: 0,
  };
  const bodyStyle: CSSProperties = {
    color: bodyColor,
    fontFamily: bodyFont,
    fontSize: fields.style_body_size || "0.95rem",
    lineHeight: fields.style_line_height || "1.7",
    margin: "10px 0 0",
  };

  const eyebrow = textFields[0];
  const title = textFields[1] || textFields[0];
  const bodies = textFields.filter((field) => field !== eyebrow && field !== title).slice(0, 5);

  return (
    <div className="sepsyg-site-live-preview" style={previewStyle}>
      <div style={cardStyle}>
        {eyebrow && eyebrow !== title && <div style={{ color: accentColor, fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>{fields[eyebrow.key]}</div>}
        {title && <h4 style={headingStyle}>{fields[title.key]}</h4>}
        {bodies.map((field) => <p key={field.key} style={bodyStyle}>{fields[field.key]}</p>)}

        {imageFields.length > 0 && (
          <div className="sepsyg-site-live-preview-images">
            {imageFields.map((field) => <img key={field.key} src={fields[field.key]} alt="" style={{ objectPosition: fields.style_image_position || "center" }} />)}
          </div>
        )}

        {linkFields.length > 0 && (
          <div className="sepsyg-site-live-preview-links">
            {linkFields.map((field) => <span key={field.key} style={{ borderColor: accentColor, color: accentColor }}>{fields[field.key]}</span>)}
          </div>
        )}
      </div>
      <div className="sepsyg-site-live-preview-meta">
        <span><b>Τίτλοι:</b> {fields.style_heading_font || "Georgia / Times New Roman"}</span>
        <span><b>Κείμενο:</b> {fields.style_body_font || "Arial / Helvetica"}</span>
        <span><b>Φόντο:</b> {sectionBackground}</span>
        <span><b>Accent:</b> {accentColor}</span>
      </div>
    </div>
  );
}

function VisionWebsitePreview({ fields }: { fields: Record<string, string> }) {
  const style = {
    "--vision-section-bg": fields.section_background || "#FFF9F3",
    "--vision-card-bg": fields.card_background || "#FFFFFF",
    "--vision-heading": fields.heading_color || "#174B49",
    "--vision-body": fields.body_color || "#627472",
    "--vision-accent": fields.accent_color || "#008D8B",
    "--vision-border": fields.border_color || "#DDE4E2",
    "--vision-heading-font": fields.heading_font || 'Georgia, "Times New Roman", serif',
    "--vision-body-font": fields.body_font || "Arial, Helvetica, sans-serif",
    "--vision-hero-title-size": fields.hero_title_size || "clamp(1.9rem, 3.8vw, 2.75rem)",
    "--vision-card-title-size": fields.card_title_size || "1.55rem",
    "--vision-body-size": fields.body_font_size || "0.98rem",
    "--vision-line-height": fields.body_line_height || "1.75",
    "--vision-eyebrow-size": fields.eyebrow_size || "0.72rem",
    "--vision-closing-size": fields.closing_font_size || "1.2rem",
    "--vision-section-pad": fields.section_padding_y || "98px",
    "--vision-gap": fields.card_gap || "28px",
    "--vision-radius": fields.card_radius || "24px",
    "--vision-content-pad": fields.content_padding || "40px 36px",
    "--vision-shadow": fields.card_shadow || "0 16px 38px rgba(0, 109, 105, 0.08)",
    "--vision-img1-pos": fields.image1_position || "40% center",
    "--vision-img2-pos": fields.image2_position || "60% center",
  } as CSSProperties & Record<string, string>;

  return (
    <div className="sepsyg-site-vision-preview" style={style}>
      <div className="sepsyg-site-vision-preview-head">
        <span>{fields.eyebrow || "Το όραμά μας"}</span>
        <h4>{fields.title || "Όραμα Συλλόγου"}</h4>
      </div>

      <div className="sepsyg-site-vision-preview-stack">
        <article className="sepsyg-site-vision-preview-card">
          <div className="sepsyg-site-vision-preview-image first">
            {fields.card1_image ? <img src={fields.card1_image} alt={fields.card1_image_alt || ""} /> : <div className="empty">Χωρίς εικόνα</div>}
            <span>{fields.card1_label || "Σωματική συνείδηση"}</span>
          </div>
          <div className="sepsyg-site-vision-preview-copy">
            <h5>{fields.card1_title || "Το σώμα ως ζωντανή πηγή εμπειρίας"}</h5>
            <p>{fields.card1_text1 || ""}</p>
            <p>{fields.card1_text2 || ""}</p>
          </div>
        </article>

        <article className="sepsyg-site-vision-preview-card reverse">
          <div className="sepsyg-site-vision-preview-image second">
            {fields.card2_image ? <img src={fields.card2_image} alt={fields.card2_image_alt || ""} /> : <div className="empty">Χωρίς εικόνα</div>}
            <span>{fields.card2_label || "Ο σκοπός μας"}</span>
          </div>
          <div className="sepsyg-site-vision-preview-copy">
            <h5>{fields.card2_title || "Μια κοινότητα ουσιαστικής θεραπείας και εξέλιξης"}</h5>
            <p>{fields.card2_text1 || ""}</p>
            <p>{fields.card2_text2 || ""}</p>
          </div>
        </article>
      </div>

      <div className="sepsyg-site-vision-preview-closing">
        <p>{fields.closing_text || ""}</p>
      </div>
    </div>
  );
}

function WebsiteContentManager({ adminName }: { adminName: string }) {
  const code = getManageCode();
  const [sections, setSections] = useState<SiteContentAdminSection[]>([]);
  const [versions, setVersions] = useState<SiteContentVersion[]>([]);
  const [selectedKey, setSelectedKey] = useState(WEBSITE_SECTION_DEFINITIONS[0].key);
  const [form, setForm] = useState<Record<string, string>>({ ...WEBSITE_SECTION_DEFINITIONS[0].defaults });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const definition = WEBSITE_SECTION_DEFINITIONS.find((item) => item.key === selectedKey) || WEBSITE_SECTION_DEFINITIONS[0];
  const remote = sections.find((item) => item.section_key === selectedKey) || null;
  const currentVersions = versions.filter((item) => item.section_key === selectedKey).slice(0, 8);
  const storedDraft = { ...definition.defaults, ...(remote?.draft || {}) };
  const published = { ...definition.defaults, ...(remote?.published || {}) };
  const dirty = JSON.stringify(form) !== JSON.stringify(storedDraft);
  const differsFromPublished = !remote?.published_at || JSON.stringify(form) !== JSON.stringify(published);

  async function loadContent(showSpinner = true) {
    if (!code) return;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/site-content?code=${encodeURIComponent(code)}&_=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "SITE_CONTENT_LOAD_FAILED");
      setSections(Array.isArray(payload.sections) ? payload.sections : []);
      setVersions(Array.isArray(payload.versions) ? payload.versions : []);
    } catch (caught) {
      setError(`Δεν φορτώθηκε η επεξεργασία ιστοσελίδας (${(caught as Error).message}).`);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    void loadContent(true);
  }, []);

  useEffect(() => {
    const nextDefinition = WEBSITE_SECTION_DEFINITIONS.find((item) => item.key === selectedKey) || WEBSITE_SECTION_DEFINITIONS[0];
    const nextRemote = sections.find((item) => item.section_key === selectedKey) || null;
    const base = { ...nextDefinition.defaults, ...(nextRemote?.draft || {}) };
    const localDraft = readLocalDraftValue<Record<string, string>>(`sepsyg-draft-site-content-v1:${selectedKey}`);
    setForm(localDraft ? { ...base, ...localDraft } : base);
    setPreviewOpen(false);
    if (localDraft && JSON.stringify({ ...base, ...localDraft }) !== JSON.stringify(base)) {
      setNotice("✓ Επαναφέρθηκαν προσωρινές αλλαγές αυτής της ενότητας από αυτόν τον browser.");
    }
  }, [selectedKey, sections]);

  function setField(key: string, value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      writeLocalDraft(`sepsyg-draft-site-content-v1:${selectedKey}`, next);
      return next;
    });
  }

  function selectWebsiteSection(nextKey: string) {
    if (nextKey === selectedKey) return;
    if (dirty && !window.confirm("Υπάρχουν μη αποθηκευμένες αλλαγές σε αυτή την ενότητα. Έχουν κρατηθεί προσωρινά σε αυτόν τον browser. Θέλεις να αλλάξεις ενότητα;")) return;
    setSelectedKey(nextKey);
  }

  async function uploadImage(field: WebsiteFieldDefinition, file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressImageFile(file);
      if (!compressed) throw new Error("IMAGE_CONVERSION_FAILED");
      setField(field.key, compressed);
    } catch (caught) {
      setError(`Δεν διαβάστηκε η εικόνα (${(caught as Error).message}).`);
    }
  }

  async function runAction(action: "save_draft" | "publish", fields = form) {
    if (!code) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/site-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          action,
          section: definition.key,
          label: definition.label,
          fields,
          updated_by: adminName,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "SITE_CONTENT_SAVE_FAILED");
      clearLocalDraft(`sepsyg-draft-site-content-v1:${definition.key}`);
      setNotice(action === "publish" ? "Η ενότητα δημοσιεύτηκε." : "Το πρόχειρο αποθηκεύτηκε.");
      window.setTimeout(() => setNotice(null), 5000);
      await loadContent(false);
    } catch (caught) {
      setError(`Δεν αποθηκεύτηκε η ενότητα (${(caught as Error).message}).`);
    } finally {
      setSaving(false);
    }
  }

  async function publishSection() {
    if (!window.confirm(`Να δημοσιευτούν οι αλλαγές στην ενότητα «${definition.label}»;`)) return;
    await runAction("publish");
  }

  async function restoreVersion(version: SiteContentVersion) {
    if (!code || !window.confirm(`Να επαναφερθεί η έκδοση ${formatSiteContentTime(version.created_at)} και να γίνει ξανά δημόσια;`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/site-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          action: "restore",
          section: definition.key,
          label: definition.label,
          version_id: version.id,
          updated_by: adminName,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code || "SITE_CONTENT_RESTORE_FAILED");
      setNotice("Η προηγούμενη έκδοση επανήλθε και δημοσιεύτηκε.");
      window.setTimeout(() => setNotice(null), 5000);
      await loadContent(false);
    } catch (caught) {
      setError(`Δεν έγινε επαναφορά (${(caught as Error).message}).`);
    } finally {
      setSaving(false);
    }
  }

  const contentFields = definition.fields.filter((field) => (field.group || "content") === "content");
  const appearanceFields = definition.fields.filter((field) => field.group === "appearance");

  function renderEditorField(field: WebsiteFieldDefinition) {
    const value = form[field.key] || "";
    const wide = field.kind === "textarea" || field.kind === "image";

    return (
      <label key={field.key} className={`sepsyg-site-editor-field ${wide ? "wide" : ""}`}>
        <span>{field.label}</span>

        {field.kind === "textarea" ? (
          <textarea value={value} onChange={(event) => setField(field.key, event.target.value)} placeholder={field.placeholder} rows={5} />
        ) : field.kind === "select" ? (
          <select value={value} onChange={(event) => setField(field.key, event.target.value)}>
            {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : field.kind === "color" ? (
          <div className="sepsyg-site-editor-color-control">
            <input
              aria-label={`${field.label} color picker`}
              type="color"
              value={normalizeEditorColor(value)}
              onChange={(event) => setField(field.key, event.target.value.toUpperCase())}
            />
            <input
              value={value}
              onChange={(event) => setField(field.key, event.target.value)}
              placeholder="#174B49"
              type="text"
            />
          </div>
        ) : (
          <input
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
            placeholder={field.placeholder || (field.kind === "url" ? "https://…" : "")}
            type={field.kind === "url" ? "url" : "text"}
          />
        )}

        {field.kind === "image" && (
          <div className="sepsyg-site-editor-image-tools">
            <input type="file" accept="image/*" onChange={(event) => void uploadImage(field, event.target.files?.[0] || null)} />
            {value && <div className="sepsyg-site-editor-image-preview"><img src={value} alt="" /><button type="button" onClick={() => setField(field.key, "")}>Αφαίρεση</button></div>}
          </div>
        )}

        {field.help && <small>{field.help}</small>}
      </label>
    );
  }

  return (
    <div className="sepsyg-site-editor">
      <div className="sepsyg-site-editor-head">
        <div>
          <span>Μόνο Διοικητικό</span>
          <h2>Επεξεργασία ιστοσελίδας</h2>
          <p>Εδώ θα συγκεντρώνονται όλα τα κείμενα, οι εικόνες, το logo και οι σύνδεσμοι της δημόσιας ιστοσελίδας. Κάθε Carrd ενότητα θα συνδέεται εδώ μία-μία, χωρίς να αλλάζουμε το design που έχεις ήδη φτιάξει.</p>
        </div>
        <div className="sepsyg-site-editor-global-status">
          <strong>{WEBSITE_SECTION_DEFINITIONS.filter((item) => item.connected).length}/{WEBSITE_SECTION_DEFINITIONS.length}</strong>
          <span>ενότητες συνδεδεμένες με Carrd</span>
        </div>
      </div>

      {error && <div className="sepsyg-site-editor-message error">{error}</div>}
      {notice && <div className="sepsyg-site-editor-message success">{notice}</div>}

      <div className="sepsyg-site-editor-layout">
        <aside className="sepsyg-site-editor-nav" aria-label="Ενότητες ιστοσελίδας">
          <div className="sepsyg-site-editor-nav-title">Ενότητες</div>
          {WEBSITE_SECTION_DEFINITIONS.map((item) => {
            const itemRemote = sections.find((section) => section.section_key === item.key);
            return (
              <button
                type="button"
                key={item.key}
                className={selectedKey === item.key ? "active" : ""}
                onClick={() => selectWebsiteSection(item.key)}
              >
                <span>{item.label}</span>
                <small className={item.connected ? "connected" : itemRemote?.published_at ? "stored" : "waiting"}>
                  {item.connected ? "Συνδεδεμένο" : itemRemote?.published_at ? "Αποθηκευμένο" : "Σε αναμονή"}
                </small>
              </button>
            );
          })}
        </aside>

        <section className="sepsyg-site-editor-main">
          <div className="sepsyg-site-editor-section-head">
            <div>
              <div className="sepsyg-site-editor-kicker">{definition.connected ? "Συνδεδεμένο με δημόσια σελίδα" : "Έτοιμο για σύνδεση με Carrd"}</div>
              <h3>{definition.label}</h3>
              <p>{definition.description}</p>
            </div>
            <div className="sepsyg-site-editor-state">
              {dirty ? <span className="dirty">Μη αποθηκευμένες αλλαγές</span> : <span>Πρόχειρο αποθηκευμένο</span>}
              {remote?.published_at ? <small>Δημοσίευση: {formatSiteContentTime(remote.published_at)}</small> : <small>Δεν έχει δημοσιευτεί ακόμη</small>}
            </div>
          </div>

          {loading ? (
            <div className="sepsyg-site-editor-loading">Φόρτωση περιεχομένου…</div>
          ) : (
            <>
              <section className="sepsyg-site-editor-group">
                <div className="sepsyg-site-editor-group-head">
                  <div><span>Περιεχόμενο</span><strong>Κείμενα, εικόνες και στοιχεία</strong></div>
                  <small>Αυτά είναι τα στοιχεία που εμφανίζονται δημόσια στην ενότητα.</small>
                </div>
                <div className="sepsyg-site-editor-fields">
                  {contentFields.map(renderEditorField)}
                </div>
              </section>

              {appearanceFields.length > 0 && (
                <details className="sepsyg-site-editor-appearance">
                  <summary>
                    <div><span>Εμφάνιση</span><strong>Χρώματα, γραμματοσειρές και διαστάσεις</strong></div>
                    <small>Οι τρέχουσες τιμές έχουν μεταφερθεί από το υπάρχον Carrd design.</small>
                  </summary>
                  <div className="sepsyg-site-editor-appearance-body">
                    <div className="sepsyg-site-editor-fields">
                      {appearanceFields.map(renderEditorField)}
                    </div>
                  </div>
                </details>
              )}

              <div className="sepsyg-site-editor-actions">
                <button type="button" className="ghost" onClick={() => setPreviewOpen((value) => !value)}>{previewOpen ? "Κλείσιμο προεπισκόπησης" : "Προεπισκόπηση"}</button>
                <button type="button" className="secondary" disabled={saving || !dirty} onClick={() => void runAction("save_draft")}>{saving ? "Αποθήκευση…" : "Αποθήκευση πρόχειρου"}</button>
                <button type="button" className="primary" disabled={saving || (!dirty && !differsFromPublished)} onClick={() => void publishSection()}>{saving ? "Δημοσίευση…" : "Δημοσίευση"}</button>
              </div>

              {previewOpen && (
                <section className="sepsyg-site-editor-preview">
                  <div className="sepsyg-site-editor-preview-head"><span>Ζωντανή προεπισκόπηση</span><strong>{definition.label}</strong></div>
                  <GenericWebsitePreview definition={definition} fields={form} />
                  {!definition.connected && <p className="sepsyg-site-editor-preview-note">Αυτή είναι προεπισκόπηση του περιεχομένου. Όταν μου στείλεις το συγκεκριμένο Carrd block, θα συνδέσουμε αυτά τα πεδία πάνω στο υπάρχον design του.</p>}
                </section>
              )}

              <section className="sepsyg-site-editor-history">
                <div className="sepsyg-site-editor-history-head">
                  <div><span>Ασφάλεια αλλαγών</span><h4>Προηγούμενες δημοσιεύσεις</h4></div>
                  <small>Κάθε δημοσίευση κρατάει έκδοση για επαναφορά.</small>
                </div>
                {currentVersions.length ? (
                  <div className="sepsyg-site-editor-history-list">
                    {currentVersions.map((version) => (
                      <div key={version.id}>
                        <div><strong>{formatSiteContentTime(version.created_at)}</strong><small>{version.created_by || "Διοίκηση"}{version.action === "restore" ? " · επαναφορά" : ""}</small></div>
                        <button type="button" disabled={saving} onClick={() => void restoreVersion(version)}>Επαναφορά</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="sepsyg-site-editor-empty-history">Δεν υπάρχει ακόμη προηγούμενη δημοσίευση για αυτή την ενότητα.</p>}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PortalHelpModal({ tab, onClose }: { tab: "map" | "calendar" | "articles" | "administration" | "website"; onClose: () => void }) {
  const content = tab === "map" ? {
    title: "Βοήθεια · Χάρτης",
    intro: "Πώς προσθέτεις ή αλλάζεις το προφίλ σου στον Χάρτη Θεραπευτών.",
    steps: [
      "Βρες την περιοχή σου στον χάρτη και πάτησε στο σημείο όπου θέλεις να εμφανίζεται η πινέζα σου.",
      "Συμπλήρωσε τα στοιχεία του θεραπευτή, την ιδιότητα, τα στοιχεία επικοινωνίας και τη φωτογραφία.",
      "Πάτησε «Αποθήκευση θεραπευτή» για να ολοκληρωθεί η καταχώριση.",
      "Για αλλαγές, άνοιξε ξανά την πινέζα σου και πάτησε «Επεξεργασία στοιχείων». Κάνε τις αλλαγές και αποθήκευσε ξανά.",
    ],
  } : tab === "calendar" ? {
    title: "Βοήθεια · Δράσεις",
    intro: "Πώς καταχωρίζεις και διαχειρίζεσαι μια δράση στο ημερολόγιο του Συλλόγου.",
    steps: [
      "Επίλεξε την ημερομηνία που θέλεις από το ημερολόγιο. Αν είναι ελεύθερη, ανοίγει η φόρμα της δράσης.",
      "Συμπλήρωσε τίτλο, ώρα, περιγραφή, μορφή, φωτογραφίες και τα στοιχεία του συντονιστή. Όσα δεν γνωρίζεις ακόμη μπορείς να τα αφήσεις για να επιστρέψεις αργότερα.",
      "Διάλεξε σωστή κατηγορία: «Δράση Συλλόγου», «Δωρεάν Δράση Συλλόγου» ή «Δράση Θεραπευτή Συλλόγου». Η τελευταία αφορά μόνο περιεχόμενο σχετικό με την εκπαίδευση Σ.Ε.ΨΥ.G.",
      "Πάτησε «Προεπισκόπηση» πριν την αποθήκευση για να δεις ακριβώς πώς θα εμφανιστεί στο κοινό.",
      "Όταν ζητάς δημόσια δημοσίευση ως θεραπευτής, η δράση περνά για έγκριση από το Διοικητικό και εμφανίζεται δημόσια μετά την έγκριση. Αν το ονοματεπώνυμό σου αντιστοιχεί στο προφίλ σου στον Χάρτη και εκεί υπάρχει έγκυρο email, το σύστημα στέλνει ενημέρωση έγκρισης για τη συγκεκριμένη ημερομηνία.",
      "Μπορείς να επιστρέψεις αργότερα στη δράση για διορθώσεις. Για αλλαγή ημερομηνίας, άνοιξε τη δράση και χρησιμοποίησε «Προηγούμενη ημέρα», «Επόμενη ημέρα» ή επίλεξε απευθείας νέα ημερομηνία. Οι συνδεδεμένες συμμετοχές και δηλώσεις πληρωμής μεταφέρονται αυτόματα μαζί με τη δράση. Αν η νέα ημέρα είναι ήδη δεσμευμένη, η εφαρμογή δεν θα επιτρέψει τη μεταφορά.",
    ],
  } : tab === "articles" ? {
    title: "Βοήθεια · Άρθρα",
    intro: "Πώς γράφεις ένα άρθρο και πώς δημοσιεύεται στην ιστοσελίδα.",
    steps: [
      "Το ονοματεπώνυμό σου συμπληρώνεται από το Login. Αν υπάρχεις στον Χάρτη Θεραπευτών, η φωτογραφία και η ιδιότητά σου συνδέονται αυτόματα.",
      "Γράψε τίτλο, σύντομη εισαγωγή, πρόσθεσε κεντρική φωτογραφία και γράψε το κείμενο στον editor.",
      "Μπορείς να επιλέξεις κείμενο με το ποντίκι και να χρησιμοποιήσεις bold, υπογράμμιση, χρώμα, κεφαλαία, emoji και τα κουμπιά A− / A / A+ / A++ για το μέγεθος των γραμμάτων.",
      "Πάτησε «Προεπισκόπηση» για να δεις το άρθρο όπως θα εμφανιστεί στον αναγνώστη.",
      "Με την υποβολή από θεραπευτή το άρθρο πηγαίνει στο Διοικητικό για έγκριση. Μετά την έγκριση εμφανίζεται στα δημόσια άρθρα.",
      "Κάθε δημοσιευμένο άρθρο αποκτά δικό του URL. Ο σύνδεσμος εμφανίζεται μόνο μέσα στην Περιοχή Θεραπευτών, στο δικό σου άρθρο (και στο Διοικητικό για όλα τα άρθρα), ώστε να τον αντιγράψεις όπου χρειάζεται.",
    ],
  } : tab === "website" ? {
    title: "Βοήθεια · Επεξεργασία ιστοσελίδας",
    intro: "Από εδώ η Διοίκηση διαχειρίζεται το περιεχόμενο της δημόσιας ιστοσελίδας χωρίς να χρειάζεται να αλλάζει κώδικα.",
    steps: [
      "Διάλεξε αριστερά την ενότητα που θέλεις να αλλάξεις, όπως Αρχική, Άρθρα, Επικοινωνία ή Γενικά & Logo.",
      "Άλλαξε τα κείμενα, τα URLs ή τις εικόνες στην περιοχή «Περιεχόμενο». Για εικόνα μπορείς να χρησιμοποιήσεις URL ή να ανεβάσεις αρχείο.",
      "Όπου έχει ήδη συνδεθεί Carrd block, άνοιξε το «Εμφάνιση» για να αλλάξεις τα βασικά χρώματα, γραμματοσειρές, μεγέθη και αποστάσεις. Οι τρέχουσες τιμές του υπάρχοντος design είναι ήδη συμπληρωμένες.",
      "Πάτησε «Αποθήκευση πρόχειρου» για να κρατήσεις τις αλλαγές χωρίς να γίνουν δημόσιες.",
      "Πάτησε «Προεπισκόπηση» για να ελέγξεις το αποτέλεσμα και μετά «Δημοσίευση» όταν είναι έτοιμο.",
      "Κάθε δημοσίευση κρατάει προηγούμενη έκδοση. Από το ιστορικό μπορείς να κάνεις «Επαναφορά» αν κάτι πάει λάθος.",
      "Οι ενότητες θα συνδέονται μία-μία με τα Carrd blocks που μου στέλνεις, ώστε να διατηρηθεί ακριβώς το υπάρχον design.",
    ],
  } : {
    title: "Βοήθεια · Διοίκηση",
    intro: "Η ενότητα αυτή εμφανίζεται μόνο στη διοικητική πρόσβαση και αντικαθιστά τα παλιά + της ιστοσελίδας.",
    steps: [
      "Στο «Διοικητικό Συμβούλιο» μπορείς να προσθέσεις νέα θητεία, να αλλάξεις ονόματα/ρόλους ή να αφαιρέσεις μια θητεία.",
      "Στα «Μέλη & Φίλοι» μπορείς να προσθέσεις νέο πρόσωπο, να αλλάξεις το ονοματεπώνυμο ή την κατηγορία του και να το αφαιρέσεις.",
      "Στο «Όλες οι δράσεις συγκεντρωτικά» βλέπεις όλες τις δηλώσεις συμμετοχής μαζί, μπορείς να κάνεις αναζήτηση και εξαγωγή CSV.",
      "Στο «Εγγραφές ενημέρωσης» βλέπεις τα email που γράφτηκαν στο newsletter της αρχικής και μπορείς να τα εξάγεις σε CSV.",
      "Οι αλλαγές αποθηκεύονται στη βάση του Συλλόγου και εμφανίζονται αυτόματα στα αντίστοιχα δημόσια embeds του Carrd.",
      "Τα δημόσια embeds δεν έχουν πλέον κουμπί + ή κωδικό διαχείρισης. Η επεξεργασία γίνεται μόνο από εδώ.",
    ],
  };

  return (
    <div className="sepsyg-help-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sepsyg-help-card" role="dialog" aria-modal="true" aria-label={content.title}>
        <button type="button" className="sepsyg-help-close" onClick={onClose} aria-label="Κλείσιμο">×</button>
        <span>Οδηγίες χρήσης</span>
        <h2>{content.title}</h2>
        <p>{content.intro}</p>
        <ol>{content.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        <button type="button" className="sepsyg-help-done" onClick={onClose}>Το κατάλαβα</button>
      </section>
    </div>
  );
}


type PortalSectionKey = "map" | "calendar" | "articles" | "administration" | "website";

function PortalNavIcon({ name }: { name: PortalSectionKey | "help" | "logout" | "external" | "menu" }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "map") return <svg {...common}><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
  if (name === "articles") return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 5.5V21M8 7h8M8 11h8M8 15h5" /></svg>;
  if (name === "administration") return <svg {...common}><path d="M4 21v-7M20 21v-7M4 14h16M6 14V8l6-4 6 4v6" /><path d="M9 21v-4h6v4" /></svg>;
  if (name === "website") return <svg {...common}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M7 6h.01M10 6h.01" /><path d="m14 15 4-4 2 2-4 4-3 1 1-3Z" /></svg>;
  if (name === "help") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.1c-.9.55-1.4 1.05-1.4 2.15M12 17h.01" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></svg>;
  if (name === "external") return <svg {...common}><path d="M14 3h7v7M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function MemberPortal() {
  const [role, setRole] = useState<ManageRole | null>(() => getManageRole());
  const [memberName, setMemberName] = useState(() => getPortalName());
  const [loginName, setLoginName] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalSectionKey>("map");
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);

  function syncMapPortalAuth() {
    mapFrameRef.current?.contentWindow?.postMessage(
      { type: "sepsyg-portal-auth", role, name: memberName },
      "https://syllogosmap.vercel.app",
    );
  }

  useEffect(() => {
    if (activeTab !== "map" || !role || !memberName) return;
    const timer = window.setTimeout(syncMapPortalAuth, 350);
    return () => window.clearTimeout(timer);
  }, [activeTab, role, memberName]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (loginName.trim().length < 2) {
      setLoginError("Γράψε το ονοματεπώνυμό σου.");
      return;
    }
    setChecking(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/verify-manage-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: loginCode.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (payload.role !== "member" && payload.role !== "admin")) throw new Error("INVALID_CODE");
      window.sessionStorage.setItem(MANAGE_ACCESS_KEY, loginCode.trim());
      window.sessionStorage.setItem(MANAGE_ROLE_KEY, payload.role);
      window.sessionStorage.setItem(PORTAL_NAME_KEY, loginName.trim());
      if (rememberMe) {
        window.localStorage.setItem(PORTAL_REMEMBER_KEY, "1");
        window.localStorage.setItem(MANAGE_ACCESS_KEY, loginCode.trim());
        window.localStorage.setItem(MANAGE_ROLE_KEY, payload.role);
        window.localStorage.setItem(PORTAL_NAME_KEY, loginName.trim());
      } else {
        window.localStorage.removeItem(PORTAL_REMEMBER_KEY);
        window.localStorage.removeItem(MANAGE_ACCESS_KEY);
        window.localStorage.removeItem(MANAGE_ROLE_KEY);
        window.localStorage.removeItem(PORTAL_NAME_KEY);
      }
      setRole(payload.role);
      setMemberName(loginName.trim());
      setActiveTab("map");
    } catch {
      setLoginError("Ο κωδικός δεν είναι σωστός.");
      setLoginCode("");
    } finally {
      setChecking(false);
    }
  }

  function logout() {
    try {
      window.sessionStorage.removeItem(MANAGE_ACCESS_KEY);
      window.sessionStorage.removeItem(MANAGE_ROLE_KEY);
      window.sessionStorage.removeItem(PORTAL_NAME_KEY);
      window.localStorage.removeItem(PORTAL_REMEMBER_KEY);
      window.localStorage.removeItem(MANAGE_ACCESS_KEY);
      window.localStorage.removeItem(MANAGE_ROLE_KEY);
      window.localStorage.removeItem(PORTAL_NAME_KEY);
    } catch { /* noop */ }
    setRole(null);
    setMemberName("");
    setLoginName("");
    setLoginCode("");
  }

  const sectionMeta: Record<PortalSectionKey, { group: string; title: string }> = {
    map: { group: "Workspace", title: "Χάρτης θεραπευτών" },
    calendar: { group: "Workspace", title: "Ημερολόγιο δράσεων" },
    articles: { group: "Workspace", title: "Άρθρα" },
    administration: { group: "Διοίκηση", title: "Διαχείριση συλλόγου" },
    website: { group: "Διοίκηση", title: "Επεξεργασία ιστοσελίδας" },
  };

  function changeSection(next: PortalSectionKey) {
    setActiveTab(next);
    setHelpOpen(false);
    setSidebarOpen(false);
  }

  if (!role || !memberName) {
    return (
      <div className="sepsyg-portal-login-page">
        <div className="sepsyg-portal-login-card">
          <AssociationLogo size="sm" />
          <span>Περιοχή θεραπευτών</span>
          <h1>Login</h1>
          <p>Γράψε το ονοματεπώνυμό σου και τον κωδικό πρόσβασης. Δεν χρειάζεται δημιουργία λογαριασμού.</p>
          <form onSubmit={login}>
            <label htmlFor="portal-name">Ονοματεπώνυμο</label>
            <input id="portal-name" value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Ονοματεπώνυμο" autoFocus required />
            <label htmlFor="portal-code">Κωδικός</label>
            <input id="portal-code" type="password" inputMode="numeric" value={loginCode} onChange={(e) => setLoginCode(e.target.value)} placeholder="••••" required />
            <label className="sepsyg-remember-me">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span><strong>Να με θυμάσαι</strong><small>Μόνο σε προσωπική συσκευή. Την επόμενη φορά θα ανοίγει κατευθείαν η περιοχή θεραπευτών.</small></span>
            </label>
            {loginError && <div className="sepsyg-portal-login-error">{loginError}</div>}
            <button type="submit" disabled={checking}>{checking ? "Έλεγχος…" : "Είσοδος"}</button>
          </form>
          <a className="sepsyg-return-site" href="https://euassociationsepsyg.carrd.co/#">← Επιστροφή στην ιστοσελίδα</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`sepsyg-member-portal ${sidebarOpen ? "sidebar-open" : ""}`}>
      <button type="button" className="sepsyg-saas-sidebar-backdrop" aria-label="Κλείσιμο μενού" onClick={() => setSidebarOpen(false)} />

      <aside className="sepsyg-saas-sidebar" aria-label="Κύρια πλοήγηση">
        <div className="sepsyg-saas-sidebar-brand">
          <AssociationLogo size="sm" centered={false} />
          <div><strong>Σ.Ε.ΨΥ.G.</strong><span>Portal Συλλόγου</span></div>
        </div>

        <nav className="sepsyg-saas-sidebar-nav">
          <div className="sepsyg-saas-nav-group">
            <span className="sepsyg-saas-nav-label">Workspace</span>
            <button type="button" className={activeTab === "map" ? "active" : ""} onClick={() => changeSection("map")}><PortalNavIcon name="map" /><span>Χάρτης</span></button>
            <button type="button" className={activeTab === "calendar" ? "active" : ""} onClick={() => changeSection("calendar")}><PortalNavIcon name="calendar" /><span>Ημερολόγιο</span></button>
            <button type="button" className={activeTab === "articles" ? "active" : ""} onClick={() => changeSection("articles")}><PortalNavIcon name="articles" /><span>Άρθρα</span></button>
          </div>

          {role === "admin" && (
            <div className="sepsyg-saas-nav-group admin">
              <span className="sepsyg-saas-nav-label">Διοίκηση</span>
              <button type="button" className={activeTab === "administration" ? "active" : ""} onClick={() => changeSection("administration")}><PortalNavIcon name="administration" /><span>Διαχείριση συλλόγου</span></button>
              <button type="button" className={activeTab === "website" ? "active" : ""} onClick={() => changeSection("website")}><PortalNavIcon name="website" /><span>Επεξεργασία ιστοσελίδας</span></button>
            </div>
          )}
        </nav>

        <div className="sepsyg-saas-sidebar-footer">
          <button type="button" className="sepsyg-saas-help-link" onClick={() => setHelpOpen(true)}><PortalNavIcon name="help" /><span>Βοήθεια</span></button>
          <div className="sepsyg-saas-user-card">
            <div className="sepsyg-saas-user-avatar">{memberName.trim().charAt(0).toUpperCase()}</div>
            <div className="sepsyg-saas-user-copy"><strong>{memberName}</strong><span>{role === "admin" ? "Διοίκηση" : "Θεραπευτής"}</span></div>
            <button type="button" className="sepsyg-saas-logout" onClick={logout} title="Έξοδος" aria-label="Έξοδος"><PortalNavIcon name="logout" /></button>
          </div>
          <a className="sepsyg-saas-return-link" href="https://euassociationsepsyg.carrd.co/#"><PortalNavIcon name="external" /><span>Δημόσια ιστοσελίδα</span></a>
        </div>
      </aside>

      <div className="sepsyg-saas-workspace">
        <header className="sepsyg-saas-topbar">
          <div className="sepsyg-saas-topbar-left">
            <button type="button" className="sepsyg-saas-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Άνοιγμα μενού"><PortalNavIcon name="menu" /></button>
            <div className="sepsyg-saas-page-title"><span>{sectionMeta[activeTab].group}</span><h1>{sectionMeta[activeTab].title}</h1></div>
          </div>
          <div className="sepsyg-saas-topbar-actions">
            <span className="sepsyg-saas-role-badge">{role === "admin" ? "Admin" : "Member"}</span>
            <button type="button" className="sepsyg-saas-top-help" onClick={() => setHelpOpen(true)} title="Βοήθεια" aria-label="Βοήθεια"><PortalNavIcon name="help" /></button>
          </div>
        </header>

        <main className="sepsyg-portal-content">
          {activeTab === "map" && <iframe ref={mapFrameRef} onLoad={syncMapPortalAuth} className="sepsyg-portal-map" title="Χάρτης Θεραπευτών" src="https://syllogosmap.vercel.app/?portal=1" />}
          {activeTab === "calendar" && <ManageApp role={role} embedded memberName={memberName} />}
          {activeTab === "articles" && <ArticlesManager role={role} memberName={memberName} />}
          {activeTab === "administration" && role === "admin" && <AdministrationManager />}
          {activeTab === "website" && role === "admin" && <WebsiteContentManager adminName={memberName} />}
        </main>
      </div>

      {helpOpen && <PortalHelpModal tab={activeTab} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

export default function App() {
  useCarrdEmbedBridge();

  const path = typeof window === "undefined" ? "/" : window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/manage") return <ManageAccess />;
  if (path === "/portal") return <MemberPortal />;
  if (path === "/articles") return <PublicArticlesApp />;
  if (path === "/articles-embed") return <PublicArticlesApp embedOnly />;
  if (path.startsWith("/article/")) return <PublicSingleArticleApp articleId={decodeURIComponent(path.slice("/article/".length))} />;
  return <PublicEventsApp />;
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

function usePreviewFileUrl(file: File | null, fallback?: string | null) {
  const [url, setUrl] = useState(fallback ?? "");

  useEffect(() => {
    if (!file) {
      setUrl(fallback ?? "");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, fallback]);

  return url;
}

function BookingForm({
  date,
  existing,
  connectionError,
  manageRole,
  ownerName,
  onEmailStatus,
  onClose,
  onSaved,
}: {
  date: string;
  existing?: Booking;
  connectionError?: string | null;
  manageRole: ManageRole;
  ownerName?: string;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [name, setName] = useState(existing?.therapist_name ?? getPortalName());
  const [coordinatorRole, setCoordinatorRole] = useState(existing?.therapist_role ?? "");
  const [additionalCoordinator, setAdditionalCoordinator] = useState(existing?.additional_coordinator_name ?? "");
  const [additionalCoordinatorRole, setAdditionalCoordinatorRole] = useState(existing?.additional_coordinator_role ?? "");
  const [hasAdditionalCoordinator, setHasAdditionalCoordinator] = useState(Boolean(existing?.additional_coordinator_name));
  const [thirdCoordinator, setThirdCoordinator] = useState(existing?.third_coordinator_name ?? "");
  const [thirdCoordinatorRole, setThirdCoordinatorRole] = useState(existing?.third_coordinator_role ?? "");
  const [hasThirdCoordinator, setHasThirdCoordinator] = useState(Boolean(existing?.third_coordinator_name));
  const [fourthCoordinator, setFourthCoordinator] = useState(existing?.fourth_coordinator_name ?? "");
  const [fourthCoordinatorRole, setFourthCoordinatorRole] = useState(existing?.fourth_coordinator_role ?? "");
  const [hasFourthCoordinator, setHasFourthCoordinator] = useState(Boolean(existing?.fourth_coordinator_name));
  const [time, setTime] = useState(existing?.action_time ?? "");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [eventType, setEventType] = useState(existing?.event_type ?? "Σεμινάριο");
  const [mode, setMode] = useState(existing?.mode ?? "Διαδικτυακά");
  const [location, setLocation] = useState(existing?.location ?? "");
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
  const [thirdCoordinatorPhotoFile, setThirdCoordinatorPhotoFile] = useState<File | null>(null);
  const [fourthCoordinatorPhotoFile, setFourthCoordinatorPhotoFile] = useState<File | null>(null);
  const [laterTime, setLaterTime] = useState(existing ? existing.action_time === null : false);
  const [laterTopic, setLaterTopic] = useState(existing ? existing.topic === null : false);
  const [laterDescription, setLaterDescription] = useState(existing ? existing.description === null : false);
  const [isPublic, setIsPublic] = useState(existing ? (existing.is_public || existing.requested_public) : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [formTherapists, setFormTherapists] = useState<TherapistDirectoryItem[]>([]);

  useEffect(() => {
    void loadTherapistDirectory().then(setFormTherapists);
  }, []);

  const matchedFormTherapist = useMemo(() => findTherapistByName(name, formTherapists), [name, formTherapists]);
  const coordinatorEmail = existing?.therapist_email || matchedFormTherapist?.email || null;

  const previewCoverUrl = usePreviewFileUrl(coverImageFile, imageUrl.trim() || existing?.image_url);
  const previewDetailUrl = usePreviewFileUrl(detailImageFile, existing?.detail_image_url);
  const previewCoordinatorPhoto = usePreviewFileUrl(coordinatorPhotoFile, existing?.coordinator_photo_url);
  const previewAdditionalPhoto = usePreviewFileUrl(additionalCoordinatorPhotoFile, existing?.additional_coordinator_photo_url);
  const previewThirdPhoto = usePreviewFileUrl(thirdCoordinatorPhotoFile, existing?.third_coordinator_photo_url);
  const previewFourthPhoto = usePreviewFileUrl(fourthCoordinatorPhotoFile, existing?.fourth_coordinator_photo_url);

  const bookingDraftKey = useMemo(
    () => `sepsyg-draft-booking-v1:${date}:${existing?.id ? "edit" : "new"}`,
    [date, existing?.id],
  );
  const bookingDraftReadyRef = useRef(false);
  const bookingBaselineRef = useRef("");
  const [bookingDraftRestored, setBookingDraftRestored] = useState(false);

  const bookingDraftPayload = {
    name,
    coordinatorRole,
    additionalCoordinator,
    additionalCoordinatorRole,
    hasAdditionalCoordinator,
    thirdCoordinator,
    thirdCoordinatorRole,
    hasThirdCoordinator,
    fourthCoordinator,
    fourthCoordinatorRole,
    hasFourthCoordinator,
    time,
    topic,
    description,
    eventType,
    mode,
    location,
    imageUrl,
    longDescription,
    audience,
    programDetails,
    activityCategory,
    generalPrice,
    offersMemberDiscount,
    memberPrice,
    laterTime,
    laterTopic,
    laterDescription,
    isPublic,
  };
  const bookingDraftFingerprint = JSON.stringify(bookingDraftPayload);

  useEffect(() => {
    bookingDraftReadyRef.current = false;
    bookingBaselineRef.current = bookingDraftFingerprint;

    const draft = readLocalDraftValue<Record<string, unknown>>(bookingDraftKey);
    if (draft) {
      if (typeof draft.name === "string") setName(draft.name);
      if (typeof draft.coordinatorRole === "string") setCoordinatorRole(draft.coordinatorRole);
      if (typeof draft.additionalCoordinator === "string") setAdditionalCoordinator(draft.additionalCoordinator);
      if (typeof draft.additionalCoordinatorRole === "string") setAdditionalCoordinatorRole(draft.additionalCoordinatorRole);
      if (typeof draft.hasAdditionalCoordinator === "boolean") setHasAdditionalCoordinator(draft.hasAdditionalCoordinator);
      if (typeof draft.thirdCoordinator === "string") setThirdCoordinator(draft.thirdCoordinator);
      if (typeof draft.thirdCoordinatorRole === "string") setThirdCoordinatorRole(draft.thirdCoordinatorRole);
      if (typeof draft.hasThirdCoordinator === "boolean") setHasThirdCoordinator(draft.hasThirdCoordinator);
      if (typeof draft.fourthCoordinator === "string") setFourthCoordinator(draft.fourthCoordinator);
      if (typeof draft.fourthCoordinatorRole === "string") setFourthCoordinatorRole(draft.fourthCoordinatorRole);
      if (typeof draft.hasFourthCoordinator === "boolean") setHasFourthCoordinator(draft.hasFourthCoordinator);
      if (typeof draft.time === "string") setTime(draft.time);
      if (typeof draft.topic === "string") setTopic(draft.topic);
      if (typeof draft.description === "string") setDescription(draft.description);
      if (typeof draft.eventType === "string") setEventType(draft.eventType);
      if (typeof draft.mode === "string") setMode(draft.mode);
      if (typeof draft.location === "string") setLocation(draft.location);
      if (typeof draft.imageUrl === "string") setImageUrl(draft.imageUrl);
      if (typeof draft.longDescription === "string") setLongDescription(draft.longDescription);
      if (typeof draft.audience === "string") setAudience(draft.audience);
      if (typeof draft.programDetails === "string") setProgramDetails(draft.programDetails);
      if (draft.activityCategory === "association" || draft.activityCategory === "association_free" || draft.activityCategory === "therapist_action") {
        setActivityCategory(draft.activityCategory);
      }
      if (typeof draft.generalPrice === "string") setGeneralPrice(draft.generalPrice);
      if (typeof draft.offersMemberDiscount === "boolean") setOffersMemberDiscount(draft.offersMemberDiscount);
      if (typeof draft.memberPrice === "string") setMemberPrice(draft.memberPrice);
      if (typeof draft.laterTime === "boolean") setLaterTime(draft.laterTime);
      if (typeof draft.laterTopic === "boolean") setLaterTopic(draft.laterTopic);
      if (typeof draft.laterDescription === "boolean") setLaterDescription(draft.laterDescription);
      if (typeof draft.isPublic === "boolean") setIsPublic(draft.isPublic);
      setBookingDraftRestored(true);
    } else {
      setBookingDraftRestored(false);
    }

    const timer = window.setTimeout(() => { bookingDraftReadyRef.current = true; }, 0);
    return () => {
      window.clearTimeout(timer);
      bookingDraftReadyRef.current = false;
    };
    // The initial fingerprint is deliberately captured before any restored draft is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDraftKey]);

  useEffect(() => {
    if (!bookingDraftReadyRef.current) return;
    writeLocalDraft(bookingDraftKey, bookingDraftPayload);
  }, [bookingDraftKey, bookingDraftFingerprint]);

  function closeBookingEditorSafely() {
    if (saving) return;
    const changed = bookingDraftFingerprint !== bookingBaselineRef.current;
    if (changed) {
      const confirmed = window.confirm(
        "Υπάρχουν αλλαγές που δεν έχουν αποθηκευτεί οριστικά. Έχουν κρατηθεί προσωρινά σε αυτόν τον browser. Θέλεις να βγεις από την επεξεργασία;",
      );
      if (!confirmed) return;
    }
    onClose();
  }

  const previewBooking: Booking = {
    id: date,
    booking_date: date,
    therapist_name: name.trim(),
    therapist_role: coordinatorRole.trim() || null,
    therapist_email: coordinatorEmail,
    additional_coordinator_name: hasAdditionalCoordinator ? additionalCoordinator.trim() || null : null,
    additional_coordinator_role: hasAdditionalCoordinator ? additionalCoordinatorRole.trim() || null : null,
    third_coordinator_name: hasThirdCoordinator ? thirdCoordinator.trim() || null : null,
    third_coordinator_role: hasThirdCoordinator ? thirdCoordinatorRole.trim() || null : null,
    fourth_coordinator_name: hasFourthCoordinator ? fourthCoordinator.trim() || null : null,
    fourth_coordinator_role: hasFourthCoordinator ? fourthCoordinatorRole.trim() || null : null,
    coordinator_photo_url: previewCoordinatorPhoto || null,
    additional_coordinator_photo_url: hasAdditionalCoordinator ? previewAdditionalPhoto || null : null,
    third_coordinator_photo_url: hasThirdCoordinator ? previewThirdPhoto || null : null,
    fourth_coordinator_photo_url: hasFourthCoordinator ? previewFourthPhoto || null : null,
    action_time: laterTime ? null : time.trim() || null,
    topic: laterTopic ? null : topic.trim() || null,
    description: laterDescription ? null : sanitizeRichHtml(description) || null,
    event_type: eventType.trim() || null,
    mode: mode.trim() || null,
    location: location.trim() || null,
    image_url: previewCoverUrl || null,
    detail_image_url: previewDetailUrl || null,
    long_description: sanitizeRichHtml(longDescription) || null,
    audience: sanitizeRichHtml(audience) || null,
    program_details: sanitizeRichHtml(programDetails) || null,
    activity_category: activityCategory,
    general_price: generalPrice.trim() || null,
    offers_member_discount: activityCategory === "association_free" ? false : offersMemberDiscount,
    member_price: activityCategory === "association_free" || !offersMemberDiscount ? null : memberPrice.trim() || null,
    requested_public: isPublic,
    approval_status: "draft",
    owner_uid: existing?.owner_uid || "preview",
    owner_name: existing ? (existing.owner_name || existing.therapist_name) : (ownerName?.trim() || getPortalName() || name.trim() || null),
    status: existing?.status || "booked",
    is_public: true,
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (name.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του βασικού συντονιστή.");
      return;
    }

    if (hasAdditionalCoordinator && additionalCoordinator.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του 2ου συντονιστή.");
      return;
    }

    if (hasThirdCoordinator && thirdCoordinator.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του 3ου συντονιστή.");
      return;
    }

    if (hasFourthCoordinator && fourthCoordinator.trim().length < 2) {
      setError("Συμπληρώστε το ονοματεπώνυμο του 4ου συντονιστή.");
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

      const uploadedThirdCoordinatorPhoto = thirdCoordinatorPhotoFile
        ? await compressImageFile(thirdCoordinatorPhotoFile)
        : "";

      const uploadedFourthCoordinatorPhoto = fourthCoordinatorPhotoFile
        ? await compressImageFile(fourthCoordinatorPhotoFile)
        : "";

      const values = {
        booking_date: date,
        therapist_name: name.trim(),
        therapist_role: coordinatorRole.trim() || null,
        therapist_email: coordinatorEmail,
        additional_coordinator_name: hasAdditionalCoordinator ? additionalCoordinator.trim() || null : null,
        additional_coordinator_role: hasAdditionalCoordinator ? additionalCoordinatorRole.trim() || null : null,
        third_coordinator_name: hasThirdCoordinator ? thirdCoordinator.trim() || null : null,
        third_coordinator_role: hasThirdCoordinator ? thirdCoordinatorRole.trim() || null : null,
        fourth_coordinator_name: hasFourthCoordinator ? fourthCoordinator.trim() || null : null,
        fourth_coordinator_role: hasFourthCoordinator ? fourthCoordinatorRole.trim() || null : null,
        coordinator_photo_url:
          uploadedCoordinatorPhoto || existing?.coordinator_photo_url || null,
        additional_coordinator_photo_url: hasAdditionalCoordinator
          ? uploadedAdditionalCoordinatorPhoto || existing?.additional_coordinator_photo_url || null
          : null,
        third_coordinator_photo_url: hasThirdCoordinator
          ? uploadedThirdCoordinatorPhoto || existing?.third_coordinator_photo_url || null
          : null,
        fourth_coordinator_photo_url: hasFourthCoordinator
          ? uploadedFourthCoordinatorPhoto || existing?.fourth_coordinator_photo_url || null
          : null,
        action_time: laterTime ? null : time.trim() || null,
        topic: laterTopic ? null : topic.trim() || null,
        description: laterDescription ? null : sanitizeRichHtml(description) || null,
        event_type: eventType.trim() || null,
        mode: mode.trim() || null,
        location: location.trim() || null,
        image_url: uploadedCover || imageUrl.trim() || existing?.image_url || null,
        detail_image_url: uploadedDetail || existing?.detail_image_url || null,
        long_description: sanitizeRichHtml(longDescription) || null,
        audience: sanitizeRichHtml(audience) || null,
        program_details: sanitizeRichHtml(programDetails) || null,
        activity_category: activityCategory,
        general_price: generalPrice.trim() || null,
        offers_member_discount: activityCategory === "association_free" ? false : (isPublic && offersMemberDiscount),
        member_price: activityCategory === "association_free" || !isPublic || !offersMemberDiscount ? null : memberPrice.trim() || null,
        requested_public: isPublic,
        approval_status: isPublic ? (manageRole === "admin" ? "approved" : "pending") : "draft",
        status: "booked" as BookingStatus,
        is_public: isPublic && manageRole === "admin",
        owner_name: existing ? (existing.owner_name || existing.therapist_name) : (ownerName?.trim() || getPortalName() || name.trim()),
      };

      if (existing) {
        await updateDoc(bookingRef, {
          ...values,
          owner_uid: existing.owner_uid,
          owner_name: existing.owner_name || existing.therapist_name,
          updated_at: serverTimestamp(),
        });

        const savedBooking = { ...existing, ...values };
        clearLocalDraft(bookingDraftKey);
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
            owner_name: ownerName?.trim() || getPortalName() || name.trim(),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        });

        const savedBooking = {
          id: date,
          ...values,
          owner_uid: user.uid,
          owner_name: ownerName?.trim() || getPortalName() || name.trim(),
        };
        clearLocalDraft(bookingDraftKey);
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
    <Modal>
      <h3 className="text-lg font-semibold">{existing ? "Επεξεργασία δέσμευσης" : "Νέα δέσμευση"}</h3>
      <p className="mb-5 mt-1 text-sm capitalize text-slate-600">{formatDateGreek(date)}</p>

      {bookingDraftRestored && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold leading-5 text-emerald-900">
          ✓ Επαναφέρθηκε το προσωρινό πρόχειρο που είχε μείνει σε αυτόν τον browser.
        </div>
      )}

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
          <label className="mb-1.5 block text-sm font-medium" htmlFor="coordinator-role">
            Ιδιότητα βασικού συντονιστή <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="coordinator-role"
            type="text"
            value={coordinatorRole}
            onChange={(event) => setCoordinatorRole(event.target.value)}
            placeholder="π.χ. Ψυχολόγος – Ψυχοθεραπευτής"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
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
            Αν ο βασικός συντονιστής υπάρχει στον Χάρτη Θεραπευτών Σ.Ε.ΨΥ.G., η φωτογραφία του εμφανίζεται αυτόματα. Διαφορετικά μπορείς να ανεβάσεις φωτογραφία εδώ.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={hasAdditionalCoordinator}
              onChange={(event) => {
                const checked = event.target.checked;
                setHasAdditionalCoordinator(checked);
                if (!checked) {
                  setAdditionalCoordinator("");
                  setAdditionalCoordinatorRole("");
                  setAdditionalCoordinatorPhotoFile(null);
                  setHasThirdCoordinator(false);
                  setThirdCoordinator("");
                  setThirdCoordinatorRole("");
                  setThirdCoordinatorPhotoFile(null);
                  setHasFourthCoordinator(false);
                  setFourthCoordinator("");
                  setFourthCoordinatorRole("");
                  setFourthCoordinatorPhotoFile(null);
                }
              }}
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="text-sm font-semibold text-slate-900">Υπάρχει 2ος συντονιστής;</span>
          </label>

          {hasAdditionalCoordinator && (
            <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="additional-coordinator">Όνομα 2ου συντονιστή</label>
                <input
                  id="additional-coordinator"
                  type="text"
                  value={additionalCoordinator}
                  onChange={(event) => setAdditionalCoordinator(event.target.value)}
                  placeholder="Ονοματεπώνυμο"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="additional-coordinator-role">Ιδιότητα / επάγγελμα 2ου συντονιστή</label>
                <input
                  id="additional-coordinator-role"
                  type="text"
                  value={additionalCoordinatorRole}
                  onChange={(event) => setAdditionalCoordinatorRole(event.target.value)}
                  placeholder="π.χ. Σύμβουλος Ψυχικής Υγείας"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="additional-coordinator-photo">Φωτογραφία 2ου συντονιστή</label>
                <input
                  id="additional-coordinator-photo"
                  type="file"
                  accept="image/*"
                  onChange={(event) => setAdditionalCoordinatorPhotoFile(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">Αν υπάρχει στον Χάρτη Θεραπευτών με το ίδιο ονοματεπώνυμο, η φωτογραφία του μπορεί να εμφανιστεί αυτόματα.</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={hasThirdCoordinator}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setHasThirdCoordinator(checked);
                      if (!checked) {
                        setThirdCoordinator("");
                        setThirdCoordinatorRole("");
                        setThirdCoordinatorPhotoFile(null);
                        setHasFourthCoordinator(false);
                        setFourthCoordinator("");
                        setFourthCoordinatorRole("");
                        setFourthCoordinatorPhotoFile(null);
                      }
                    }}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="text-sm font-semibold text-slate-900">Υπάρχει 3ος συντονιστής;</span>
                </label>

                {hasThirdCoordinator && (
                  <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="third-coordinator">Όνομα 3ου συντονιστή</label>
                      <input id="third-coordinator" type="text" value={thirdCoordinator} onChange={(event) => setThirdCoordinator(event.target.value)} placeholder="Ονοματεπώνυμο" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="third-coordinator-role">Ιδιότητα / επάγγελμα 3ου συντονιστή</label>
                      <input id="third-coordinator-role" type="text" value={thirdCoordinatorRole} onChange={(event) => setThirdCoordinatorRole(event.target.value)} placeholder="π.χ. Ψυχολόγος – Ψυχοθεραπευτής" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="third-coordinator-photo">Φωτογραφία 3ου συντονιστή</label>
                      <input id="third-coordinator-photo" type="file" accept="image/*" onChange={(event) => setThirdCoordinatorPhotoFile(event.target.files?.[0] ?? null)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={hasFourthCoordinator}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setHasFourthCoordinator(checked);
                            if (!checked) {
                              setFourthCoordinator("");
                              setFourthCoordinatorRole("");
                              setFourthCoordinatorPhotoFile(null);
                            }
                          }}
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <span className="text-sm font-semibold text-slate-900">Υπάρχει 4ος συντονιστής;</span>
                      </label>

                      {hasFourthCoordinator && (
                        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium" htmlFor="fourth-coordinator">Όνομα 4ου συντονιστή</label>
                            <input id="fourth-coordinator" type="text" value={fourthCoordinator} onChange={(event) => setFourthCoordinator(event.target.value)} placeholder="Ονοματεπώνυμο" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium" htmlFor="fourth-coordinator-role">Ιδιότητα / επάγγελμα 4ου συντονιστή</label>
                            <input id="fourth-coordinator-role" type="text" value={fourthCoordinatorRole} onChange={(event) => setFourthCoordinatorRole(event.target.value)} placeholder="π.χ. Εκπαιδευτής / Θεραπευτής" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium" htmlFor="fourth-coordinator-photo">Φωτογραφία 4ου συντονιστή</label>
                            <input id="fourth-coordinator-photo" type="file" accept="image/*" onChange={(event) => setFourthCoordinatorPhotoFile(event.target.files?.[0] ?? null)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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

        <RichOptionalField
          id="description"
          label="Σύντομη περιγραφή"
          value={description}
          onChange={setDescription}
          later={laterDescription}
          onLaterChange={setLaterDescription}
          placeholder="Λίγες πληροφορίες για το περιεχόμενο της δράσης"
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
                setOffersMemberDiscount(false);
                setMemberPrice("");
              }
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="association">Δράση Συλλόγου</option>
            <option value="association_free">Δωρεάν Δράση Συλλόγου</option>
            <option value="therapist_action">Δράση Θεραπευτή Συλλόγου</option>
          </select>

          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-600">
            <span className="border-b-4 border-[#63A97E] pb-1">Πράσινο · Δωρεάν</span>
            <span className="border-b-4 border-[#E39A55] pb-1">Πορτοκαλί · Δράση Συλλόγου</span>
            <span className="border-b-4 border-[#79B9D3] pb-1">Γαλάζιο · Δράση Θεραπευτή Συλλόγου</span>
          </div>

          {activityCategory === "therapist_action" && (
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900">
              Η επιλογή αυτή αφορά δράση θεραπευτή του Συλλόγου και χρησιμοποιείται μόνο όταν το περιεχόμενο της δράσης σχετίζεται με την εκπαίδευση Σ.Ε.ΨΥ.G.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="general-price">
            Τιμή / κόστος <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="general-price"
            type="text"
            value={generalPrice}
            onChange={(event) => setGeneralPrice(event.target.value)}
            placeholder="π.χ. Δωρεάν · Από 135€ · 30€ · Επικοινωνήστε μαζί μας"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1.5 text-xs leading-5 text-slate-500">Γράψε ακριβώς αυτό που θέλεις να εμφανίζεται δημόσια. Αν το αφήσεις κενό, δεν θα εμφανιστεί πλαίσιο κόστους (εκτός από κατηγορία «Δωρεάν Δράση», όπου εμφανίζεται αυτόματα «Δωρεάν»).</p>
        </div>

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

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="event-location">
            📍 Τοποθεσία / σημείο συμμετοχής <span className="font-normal text-slate-400">(προαιρετικό)</span>
          </label>
          <input
            id="event-location"
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="π.χ. Ηράκλειο · Αθήνα · Διαδικτυακά · Zoom"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1.5 text-xs leading-5 text-slate-500">Ό,τι γράψεις εδώ θα εμφανίζεται πάνω στη δράση, σε ξεχωριστό πλαίσιο με 📍. Αν η δράση είναι online μπορείς απλώς να γράψεις «Διαδικτυακά».</p>
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
          <label className="mb-1.5 block text-sm font-medium" htmlFor="long-description">Αναλυτική περιγραφή <span className="font-normal text-slate-400">(προαιρετικό)</span></label>
          <RichTextEditor id="long-description" value={longDescription} onChange={setLongDescription} placeholder="Γράψε το πλήρες κείμενο της δράσης όπως θέλεις να εμφανίζεται στο «Δείτε περισσότερα»." />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="audience">Σε ποιους απευθύνεται <span className="font-normal text-slate-400">(προαιρετικό)</span></label>
          <RichTextEditor id="audience" value={audience} onChange={setAudience} placeholder="π.χ. επαγγελματίες ψυχικής υγείας, εκπαιδευόμενοι, ευρύ κοινό..." />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="program-details">Πρόγραμμα / θεματικές ενότητες <span className="font-normal text-slate-400">(προαιρετικό)</span></label>
          <RichTextEditor id="program-details" value={programDetails} onChange={setProgramDetails} placeholder="Γράψε τις βασικές θεματικές, το πρόγραμμα ή τα σημεία που θα δουλευτούν." />
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
                    type="text"
                    value={memberPrice}
                    onChange={(event) => setMemberPrice(event.target.value)}
                    placeholder="π.χ. 20€ · Από 15€ · Δωρεάν"
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            disabled={saving}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            👁 Προεπισκόπηση
          </button>
          <button
            type="button"
            onClick={closeBookingEditorSafely}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            Έξοδος
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

      {showPreview && (
        <PublicBookingDetails
          booking={previewBooking}
          therapistDirectory={[]}
          previewMode
          onClose={() => setShowPreview(false)}
        />
      )}
    </Modal>
  );
}

function RichOptionalField({
  id,
  label,
  value,
  onChange,
  later,
  onLaterChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  later: boolean;
  onLaterChange: (value: boolean) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor={id}>{label}</label>
      <RichTextEditor id={id} value={later ? "" : value} onChange={onChange} disabled={later} placeholder={placeholder} />
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={later} onChange={(event) => onLaterChange(event.target.checked)} className="h-4 w-4 accent-emerald-600" />
        Θα επιστρέψω να το συμπληρώσω
      </label>
    </div>
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
  canShareUrl,
  onViewRegistrations,
  onClose,
  onEdit,
  canApprove,
  onApproved,
  onEmailStatus,
  onMoved,
  onDeleted,
}: {
  booking: Booking;
  canManage: boolean;
  registrationCount: number;
  canViewRegistrationDetails: boolean;
  canShareUrl: boolean;
  onViewRegistrations: () => void;
  onClose: () => void;
  onEdit: () => void;
  canApprove: boolean;
  onApproved: (booking: Booking) => void;
  onEmailStatus: (result: { ok: boolean; code: string }) => void;
  onMoved: (fromDate: string, booking: Booking, registrationCount: number) => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  function offsetDate(isoDate: string, delta: number) {
    const [year, month, day] = isoDate.split("-").map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + delta);
    return value.toISOString().slice(0, 10);
  }

  async function handleMoveTo(targetDate: string, label?: string) {
    if (!canManage) {
      setError("Μόνο ο δημιουργός της δράσης ή η Διοίκηση μπορεί να τη μετακινήσει.");
      return;
    }
    if (!targetDate || targetDate === booking.booking_date) return;
    if (targetDate < "2026-07-01" || targetDate > "2027-08-31") {
      setError("Η νέα ημερομηνία είναι έξω από το διαθέσιμο ημερολόγιο.");
      return;
    }
    const extra = registrationCount > 0 ? ` Οι ${registrationCount} συμμετοχές θα μεταφερθούν αυτόματα μαζί με τη δράση.` : "";
    if (!window.confirm(`Μεταφορά της δράσης${label ? ` ${label}` : ""} στις ${formatDateGreek(targetDate)};${extra}`)) return;

    setMoving(true);
    setError(null);
    try {
      const response = await fetch("/api/move-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: getManageCode(), actorName: getPortalName(), eventId: booking.booking_date, targetDate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const labels: Record<string, string> = {
          TARGET_DATE_OCCUPIED: "Η ημερομηνία αυτή είναι ήδη δεσμευμένη.",
          DATE_OUT_OF_RANGE: "Η νέα ημερομηνία είναι έξω από το διαθέσιμο ημερολόγιο.",
          EVENT_NOT_FOUND: "Η δράση δεν βρέθηκε.",
          EVENT_OWNER_REQUIRED: "Μόνο ο δημιουργός της δράσης ή η Διοίκηση μπορεί να τη μετακινήσει.",
        };
        throw Object.assign(new Error(labels[payload.code] || "Δεν ήταν δυνατή η μεταφορά της δράσης."), { code: payload.code });
      }
      const moved = payload.booking as Booking;
      onMoved(booking.booking_date, moved, Number(payload.registrationCount || 0));
      void notifyAdmin("update", moved).then(onEmailStatus);
    } catch (caughtError) {
      setError((caughtError as Error).message || "Δεν ήταν δυνατή η μεταφορά της δράσης.");
    } finally {
      setMoving(false);
    }
  }

  async function handleMove(delta: number) {
    const targetDate = offsetDate(booking.booking_date, delta);
    await handleMoveTo(targetDate, delta < 0 ? "στην προηγούμενη ημέρα" : "στην επόμενη ημέρα");
  }

  async function copyEventUrl() {
    const url = eventPublicUrl(booking.booking_date);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1800);
    } catch {
      window.prompt("Αντέγραψε τον σύνδεσμο:", url);
    }
  }

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
      setApprovalNotice(payload.approvalEmailSent
        ? "Η δράση εγκρίθηκε και στάλθηκε email ενημέρωσης στον θεραπευτή."
        : "Η δράση εγκρίθηκε. Δεν στάλθηκε email ενημέρωσης — έλεγξε ότι το προφίλ του θεραπευτή στον Χάρτη έχει σωστό email.");
    } catch (caughtError) {
      const code = (caughtError as { code?: string } | null)?.code;
      setError(`Δεν ήταν δυνατή η έγκριση${code ? ` (${code})` : ""}.`);
    } finally {
      setApproving(false);
    }
  }

  async function handleDelete() {
    if (!canManage) {
      setError("Μόνο ο δημιουργός της δράσης ή η Διοίκηση μπορεί να τη διαγράψει.");
      return;
    }
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
    <Modal onClose={deleting || moving || approving ? undefined : onClose}>
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
        <DetailRow label="Ιδιότητα βασικού συντονιστή" value={booking.therapist_role || "—"} />
        {booking.additional_coordinator_name && (
          <DetailRow label="Ιδιότητα 2ου συντονιστή" value={booking.additional_coordinator_role || "—"} />
        )}
        {booking.third_coordinator_name && (
          <DetailRow label="Ιδιότητα 3ου συντονιστή" value={booking.third_coordinator_role || "—"} />
        )}
        {booking.fourth_coordinator_name && (
          <DetailRow label="Ιδιότητα 4ου συντονιστή" value={booking.fourth_coordinator_role || "—"} />
        )}
        <DetailRow label="Ώρα" value={booking.action_time} />
        <DetailRow label="Τοποθεσία" value={booking.location || null} />
        <DetailRow label="Θέμα" value={booking.topic} />
        <DetailRow label="Περιγραφή" value={richTextToPlainText(booking.description)} />
        <DetailRow label="Κατηγορία" value={activityCategoryLabel(booking)} />
        <DetailRow label="Γενική τιμή" value={activityPriceLabel(booking)} />
        {booking.offers_member_discount && (
          <DetailRow label="Τιμή Μελών / Φίλων" value={booking.member_price || null} />
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

      {canShareUrl && booking.is_public && (
        <div className="sepsyg-internal-share-box">
          <span>Σύνδεσμος δημόσιας δράσης</span>
          <code>{eventPublicUrl(booking.booking_date)}</code>
          <button type="button" onClick={() => void copyEventUrl()}>{urlCopied ? "✓ Αντιγράφηκε" : "Αντιγραφή URL"}</button>
        </div>
      )}

      {canShareUrl && !booking.is_public && booking.approval_status === "pending" && (
        <p className="sepsyg-url-pending">Το δημόσιο URL θα εμφανιστεί εδώ μόλις εγκριθεί η δράση.</p>
      )}

      {approvalNotice && (
        <p className={`mt-4 rounded-md px-3 py-2 text-sm ${!approvalNotice.includes("Δεν στάλθηκε") ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{approvalNotice}</p>
      )}

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

      {canManage && !isCompleted && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Μετακίνηση ημερομηνίας</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void handleMove(-1)} disabled={moving || deleting || approving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">← Προηγούμενη ημέρα</button>
            <button type="button" onClick={() => void handleMove(1)} disabled={moving || deleting || approving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Επόμενη ημέρα →</button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id={`move-date-${booking.booking_date}`}
              type="date"
              min="2026-07-01"
              max="2027-08-31"
              defaultValue={booking.booking_date}
              disabled={moving || deleting || approving}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={moving || deleting || approving}
              onClick={() => {
                const input = document.getElementById(`move-date-${booking.booking_date}`) as HTMLInputElement | null;
                if (input?.value) void handleMoveTo(input.value);
              }}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Μεταφορά σε αυτή την ημερομηνία
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">Οι συμμετοχές και οι συνδεδεμένες δηλώσεις μεταφέρονται αυτόματα μαζί με τη δράση.</p>
          {moving && <p className="mt-2 text-xs text-slate-500">Μεταφορά δράσης και συνδεδεμένων συμμετοχών…</p>}
        </div>
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
              disabled={deleting || moving}
              className="rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {deleting ? "Ακύρωση…" : "Ακύρωση δέσμευσης"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={deleting || moving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              Επεξεργασία
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={deleting || moving}
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

let sepsygModalLockCount = 0;

function useModalScrollLock() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    sepsygModalLockCount += 1;
    root.classList.add("sepsyg-modal-open");
    body?.classList.add("sepsyg-modal-open");
    if (sepsygModalLockCount === 1 && window.parent !== window) {
      window.parent.postMessage({ type: "SEPSYG_MODAL_STATE", open: true }, "*");
    }
    return () => {
      sepsygModalLockCount = Math.max(0, sepsygModalLockCount - 1);
      if (sepsygModalLockCount === 0) {
        root.classList.remove("sepsyg-modal-open");
        body?.classList.remove("sepsyg-modal-open");
        if (window.parent !== window) {
          window.parent.postMessage({ type: "SEPSYG_MODAL_STATE", open: false }, "*");
        }
      }
    };
  }, []);
}

function Modal({ children, onClose, wide = false, landing = false }: { children: ReactNode; onClose?: () => void; wide?: boolean; landing?: boolean }) {
  useModalScrollLock();
  const sizeClass = landing ? "max-w-6xl sm:min-h-[86vh]" : wide ? "max-w-5xl" : "max-w-lg";
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-950/50 p-2 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`my-2 max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:my-auto sm:max-h-[calc(100vh-2rem)] sm:p-6 ${sizeClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
