# Ρύθμιση λιστών συμμετοχών στο Vercel

Η εφαρμογή αποθηκεύει τα προσωπικά στοιχεία συμμετεχόντων μέσω ασφαλούς server endpoint. Τα στοιχεία δεν είναι δημόσια προσβάσιμα από το Firebase frontend.

## 1. Firebase Service Account

Στο Firebase Console:

1. Project settings (γρανάζι)
2. Service accounts
3. Generate new private key
4. Κατέβασε το JSON και φύλαξέ το ιδιωτικά

Μην ανεβάσεις ποτέ αυτό το JSON στο GitHub.

## 2. Vercel Environment Variables

Στο Vercel: Project → Settings → Environment Variables, πρόσθεσε:

- `FIREBASE_PROJECT_ID` → η τιμή `project_id` από το JSON
- `FIREBASE_CLIENT_EMAIL` → η τιμή `client_email` από το JSON
- `FIREBASE_PRIVATE_KEY` → ολόκληρη η τιμή `private_key`, μαζί με BEGIN/END PRIVATE KEY
- `MANAGE_CODE` → `1111`

Οι υπάρχουσες μεταβλητές email παραμένουν:

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `NOTIFY_TO`

Επίλεξε Production για όλες και κάνε νέο Redeploy.

## 3. Firestore Rules

Δεν χρειάζεται να ανοίξεις δημόσια τη συλλογή `eventRegistrations`. Η εφαρμογή τη διαχειρίζεται μόνο από τις ασφαλείς Vercel Functions. Οι υπάρχοντες κανόνες για τη συλλογή `bookings` παραμένουν.

## 4. Δοκιμή

1. Άνοιξε `/events`.
2. Πάτησε μια προσεχή δημόσια δράση.
3. Πάτησε «Θέλω να παρακολουθήσω» και συμπλήρωσε τη φόρμα.
4. Άνοιξε `/manage`, πάτησε την ίδια δράση και μετά «Προβολή συμμετοχών».
