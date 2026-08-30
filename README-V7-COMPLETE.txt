SEPSYG V7 COMPLETE — CMS + 14 CARRD EMBEDS + ADMIN REPORTS + NEWSLETTER + RICH TEXT BIO
=======================================================================================

ΤΙ ΠΕΡΙΛΑΜΒΑΝΕΙ
----------------
1. Όλα τα 14 Carrd embeds συνδεδεμένα με το CMS «Επεξεργασία ιστοσελίδας».
2. Τα υπάρχοντα κείμενα, εικόνες, links και βασικές τιμές εμφάνισης έχουν περαστεί ως default τιμές.
3. Στο CMS υπάρχουν δύο επίπεδα: Περιεχόμενο και Εμφάνιση.
4. Η προεπισκόπηση δείχνει τα ενεργά χρώματα, γραμματοσειρές, μεγέθη, εικόνες και links πριν τη δημοσίευση.
5. Το Hero έχει φόρμα newsletter. Οι εγγραφές αποθηκεύονται στο Firestore.
6. Στη «Διοίκηση» υπάρχει συγκεντρωτική λίστα συμμετοχών από ΟΛΕΣ τις δράσεις, αναζήτηση και Export CSV.
7. Στη «Διοίκηση» υπάρχει και λίστα newsletter + Export CSV.
8. Διορθώθηκε η οπτική εμφάνιση του Bold στο rich text.
9. Στον Χάρτη θεραπευτών το βιογραφικό αποκτά rich-text toolbar: Bold, underline, μέγεθος, χρώματα, emoji.
10. Το αριστερό sidebar έχει λίγο μεγαλύτερα γράμματα και μικρότερο logo.

A. REPOSITORY hmerologiosillogou
-------------------------------
Αντικατάσταση ολόκληρων αρχείων:
- src/App.tsx
- src/styles.css
- api/site-content.js
- api/event-registrations.js

Νέα αρχεία:
- api/newsletter-signup.js
- public/site-cms.js

Δεν χρειάζεται νέο Vercel environment variable. Το newsletter χρησιμοποιεί τα ήδη υπάρχοντα:
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, ADMIN_CODE, MANAGE_CODE.

B. CARRD
--------
Στον φάκελο carrd_embeds υπάρχουν 14 έτοιμα .txt/.html.
Σε κάθε αντίστοιχο Carrd Embed: σβήνεις όλο το παλιό block και επικολλάς όλο το νέο .txt.

01 Hero
02 Ο Σύλλογος με μια ματιά
03 Δράσεις (στατικό block αρχικής)
04 Membership / φόρμα
05 Όραμα
06 Unity Energetics
07 Προσέγγιση
08 Μέλη & Φίλοι
09 Διοικητικό Συμβούλιο
10 Θεραπευτές
11 Γίνε Μέλος / Φίλος
12 Menu
13 Επικοινωνία
14 Footer

Τα embeds κρατούν τα σημερινά δεδομένα ως fallback. Άρα ακόμη κι αν το CMS API δεν απαντήσει, δεν μένει άδειο το Carrd block.

C. REPOSITORY syllogosmap
-------------------------
Για να εμφανιστούν τα εργαλεία rich-text στο βιογραφικό θεραπευτή:
- αντικατάσταση ολόκληρου του index.html με το αρχείο syllogosmap/index.html του πακέτου.

D. ΠΡΩΤΗ ΔΗΜΟΣΙΕΥΣΗ CMS
------------------------
Μετά το deploy:
Portal -> Επεξεργασία ιστοσελίδας -> διάλεξε ενότητα -> Δημοσίευση.
Μέχρι να γίνει η πρώτη δημοσίευση κάθε ενότητας, το Carrd συνεχίζει να εμφανίζει τις υπάρχουσες fallback τιμές.

ΕΛΕΓΧΟΙ ΠΟΥ ΕΓΙΝΑΝ
-------------------
- App.tsx: TypeScript/TSX parse OK.
- site-content.js: JS syntax OK.
- event-registrations.js: JS syntax OK.
- newsletter-signup.js: JS syntax OK.
- public/site-cms.js: JS syntax OK.
- styles.css: balanced braces OK.
- syllogosmap inline JavaScript: syntax OK.
- 14 Carrd embeds: inline JavaScript syntax OK.
- Έλεγχος mappings: όλα τα Carrd CMS mappings αντιστοιχούν σε πεδία του CMS, χωρίς διπλούς selector στόχους.

ΣΗΜΕΙΩΣΗ
--------
Δεν εκτελέστηκε πλήρες Vite production build μέσα στο περιβάλλον εργασίας, επειδή το npm install δεν ολοκληρώθηκε αξιόπιστα εδώ. Έγιναν όμως οι παραπάνω syntax/static checks. Το Vercel build θα είναι ο τελικός production έλεγχος.
