# Διαθεσιμότητα Θεραπευτών για Δράσεις

Μονοσέλιδη εφαρμογή React/Vite που χρησιμοποιεί Firebase Authentication και Cloud Firestore.

## Τι περιλαμβάνει

- Μήνες από **Ιούλιο 2026** έως **Αύγουστο 2027**.
- Ζωντανές κρατήσεις σε κοινή βάση Firestore.
- Ιστορική, λιλά καταχώριση για **5 Ιουλίου 2026**:
  - Ευαγγελία Ξανθοπούλου · Μαρία Ζάχου
  - 19:30 – 21:30
  - Από την εσωτερική ησυχία στην αυθεντική συνάντηση
- Αποτροπή διπλής κράτησης της ίδιας ημέρας.
- Επεξεργασία / ακύρωση μόνο από τον ίδιο browser που δημιούργησε την κράτηση.

## Τι έχει ήδη ρυθμιστεί

- Τα στοιχεία του Firebase project `imerologiosullogou` βρίσκονται στο `src/firebase.ts`.
- Η εφαρμογή συνδέεται ανώνυμα στο Firebase.
- Οι κρατήσεις αποθηκεύονται στη συλλογή `bookings`.
- Κάθε ημερομηνία είναι μοναδικό Firestore document, άρα αποτρέπεται η διπλή κράτηση με transaction.
- Οι αλλαγές εμφανίζονται ζωντανά σε όλους με realtime listener.

## Απαραίτητη ρύθμιση στο Firebase

1. Firebase Console → **Authentication** → **Sign-in method** → ενεργοποίησε `Anonymous`.
2. Firebase Console → **Firestore Database** → **Create database**.
3. Firestore → **Rules** → αντικατάστησε τους κανόνες με το περιεχόμενο του `firestore.rules` και πάτησε **Publish**.
4. Firebase Console → **Authentication** → **Settings** → **Authorized domains** → πρόσθεσε το domain του Vercel σου.

Αν δεν γίνει το βήμα 3 ή 4, η εφαρμογή θα ανοίγει αλλά η αποθήκευση θα αποτυγχάνει.

## Ανέβασμα σε GitHub και Vercel

1. Ανέβασε όλα τα αρχεία αυτού του φακέλου σε νέο GitHub repository.
2. Στο Vercel πάτησε **Add New → Project** και σύνδεσε το repository.
3. Το Vercel θα αναγνωρίσει Vite. Οι σωστές ρυθμίσεις είναι ήδη στο `vercel.json`:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Πάτησε **Deploy**.

Δεν χρειάζονται environment variables στο Vercel για αυτή την έκδοση.

## Τοπική εκτέλεση

```bash
npm install
npm run dev
```

## Δύο προβολές

- Εσωτερικό ημερολόγιο μελών: `/manage` ή ο βασικός σύνδεσμος `/`
- Δημόσιο πρόγραμμα: `/events`

Στη φόρμα κράτησης υπάρχει επιλογή **«Να εμφανίζεται στο δημόσιο πρόγραμμα»**. Μόνο οι καταχωρίσεις με ενεργή αυτή την επιλογή εμφανίζονται στο `/events`. Για δημόσια εμφάνιση απαιτούνται ώρα και θέμα.

## Πρόσθετες λειτουργίες

- `/manage`: εμφανίζει πρώτα πλαίσιο εισόδου με κωδικό `1111`. Η πρόσβαση διατηρείται μόνο για τη συγκεκριμένη συνεδρία του browser.
- `/events`: δημόσιο πρόγραμμα δράσεων.
- Κάτω από το δημόσιο πρόγραμμα υπάρχει φόρμα «Γίνε Φίλος του Συλλόγου».
- Η φόρμα στέλνει email στο `NOTIFY_TO` μέσω του endpoint `/api/send-friend-request`.
- Χρησιμοποιεί τις ίδιες μεταβλητές Vercel: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_TO`.

Ο κωδικός `1111` είναι απλό οπτικό εμπόδιο και όχι ισχυρή αυθεντικοποίηση.

## Mobile/current-month update
- On phones, the calendar fits the screen without horizontal scrolling.
- Month selection uses a dropdown on small screens.
- The app opens directly on the current month when it is within July 2026–August 2027.
- Association website link: https://eusyllogossepshyg.carrd.co/

## Κρατήσεις θέσεων ανά event

Η δημόσια σελίδα `/events` περιλαμβάνει φόρμα «Θέλω να παρακολουθήσω» για κάθε προσεχή δημόσια δράση. Οι συμμετοχές αποθηκεύονται ανά event και είναι ορατές συγκεντρωτικά μόνο στο `/manage`.

Στη διαχείριση εμφανίζονται:

- αριθμός συμμετοχών ανά δράση,
- ονοματεπώνυμο, email, τηλέφωνο και επάγγελμα,
- προαιρετικό σχόλιο,
- ημερομηνία υποβολής,
- διαγραφή συμμετοχής,
- εξαγωγή CSV.

Για τη ρύθμιση των ασφαλών server endpoints διάβασε το `PARTICIPATION_SETUP_VERCEL.md`.


## Δύο επίπεδα πρόσβασης

Στο Vercel διατήρησε:

```text
MANAGE_CODE=1111
```

και πρόσθεσε:

```text
ADMIN_CODE=2222
```

- Το `1111` επιτρέπει διαχείριση δράσεων και προβολή μόνο του αριθμού συμμετοχών.
- Το `2222` επιτρέπει επιπλέον προβολή προσωπικών στοιχείων, διαγραφή συμμετοχών και εξαγωγή CSV.
