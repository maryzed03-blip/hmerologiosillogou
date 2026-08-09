# SEPSYG v1.8 — FIX /manage

## Αιτία λευκής σελίδας
Στο ManageApp υπήρχε κατά λάθος:
`loadTherapistDirectory().then(setTherapistDirectory)`

Το `setTherapistDirectory` δεν υπήρχε στο ManageApp, άρα μετά την επιτυχημένη
είσοδο με 1111 ή 2222 προκαλούνταν runtime ReferenceError και η σελίδα γινόταν κενή.

## Διόρθωση
- Αφαιρέθηκε το λανθασμένο effect από το ManageApp.
- Η φόρτωση Therapist Directory μεταφέρθηκε στο PublicEventsApp, όπου υπάρχει
  κανονικά το state `therapistDirectory`.
- Οι κωδικοί παραμένουν:
  - 1111 = member
  - 2222 = admin
  εφόσον δεν έχουν αντικατασταθεί από MANAGE_CODE / ADMIN_CODE στο Vercel.

## Συμμετέχοντες
Το admin role παραμένει το μόνο που βλέπει αναλυτικά προσωπικά στοιχεία
και επιτρέπει εξαγωγή CSV.
