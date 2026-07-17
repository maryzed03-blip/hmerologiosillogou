# Διαθεσιμότητα Θεραπευτών για Δράσεις

Μονοσέλιδη εφαρμογή React/Vite που χρησιμοποιεί Firebase Authentication και Cloud Firestore.

## Τι έχει ήδη ρυθμιστεί

- Τα στοιχεία του Firebase project `imerologiosullogou` βρίσκονται στο `src/firebase.ts`.
- Η εφαρμογή συνδέεται ανώνυμα στο Firebase.
- Οι κρατήσεις αποθηκεύονται στη συλλογή `bookings`.
- Κάθε ημερομηνία είναι μοναδικό Firestore document, άρα αποτρέπεται η διπλή κράτηση με transaction.
- Οι αλλαγές εμφανίζονται ζωντανά σε όλους με realtime listener.
- Μόνο ο ίδιος browser που έκανε την κράτηση μπορεί να την επεξεργαστεί ή να τη διαγράψει.

## Απαραίτητη ρύθμιση στο Firebase

1. Firebase Console → Authentication → Sign-in method → ενεργοποίησε `Anonymous`.
2. Firebase Console → Firestore Database → Create database.
3. Firestore → Rules → αντικατάστησε τους κανόνες με το περιεχόμενο του `firestore.rules` και πάτησε Publish.

## Ανέβασμα σε GitHub και Vercel

1. Ανέβασε όλα τα αρχεία αυτού του φακέλου σε νέο GitHub repository.
2. Στο Vercel πάτησε Add New → Project και σύνδεσε το repository.
3. Το Vercel θα αναγνωρίσει Vite. Οι σωστές ρυθμίσεις είναι ήδη στο `vercel.json`:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Πάτησε Deploy.

Δεν χρειάζονται environment variables στο Vercel για αυτή την έκδοση.

## Τοπική εκτέλεση

```bash
npm install
npm run dev
```
