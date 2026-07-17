import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCBimPw1xvGMUyRZomN60ZJKpU9ZcvTovw",
  authDomain: "imerologiosullogou.firebaseapp.com",
  projectId: "imerologiosullogou",
  storageBucket: "imerologiosullogou.firebasestorage.app",
  messagingSenderId: "595458367967",
  appId: "1:595458367967:web:8609d1ace41d7dfda7e46a",
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);

let anonymousUserPromise: Promise<User> | null = null;

export function ensureAnonymousUser(): Promise<User> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Firebase Authentication requires a browser."));
  }

  const auth = getAuth(app);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!anonymousUserPromise) {
    anonymousUserPromise = signInAnonymously(auth)
      .then((credential) => credential.user)
      .catch((error) => {
        anonymousUserPromise = null;
        throw error;
      });
  }

  return anonymousUserPromise;
}
