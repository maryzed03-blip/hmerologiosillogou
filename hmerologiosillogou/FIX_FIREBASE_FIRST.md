# Απαραίτητη ρύθμιση Firebase

Η εφαρμογή ανοίγει τις ημέρες ακόμη και όταν υπάρχει πρόβλημα σύνδεσης. Για να αποθηκεύονται όμως οι κρατήσεις ζωντανά, χρειάζονται και τα δύο παρακάτω:

## 1. Firestore Database
Firebase Console → Build → Firestore Database → Create database → Production mode.

Μετά: Firestore Database → Rules → επικόλλησε όλο το περιεχόμενο του αρχείου `firestore.rules` → Publish.

## 2. Vercel domain
Firebase Console → Authentication → Settings → Authorized domains → Add domain.

Πρόσθεσε το domain που σου έδωσε το Vercel, χωρίς `https://` και χωρίς `/`.
Παράδειγμα: `hmerologiosillogou.vercel.app`

Η ανώνυμη σύνδεση πρέπει επίσης να είναι ενεργή:
Authentication → Sign-in method → Anonymous → Enable.
