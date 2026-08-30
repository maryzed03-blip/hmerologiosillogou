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

const associationFirebaseConfig = {
  apiKey: "AIzaSyCodx-CuHNysOVROtLcCuRtgxcB4oovPVc",
  authDomain: "syllogos-map.firebaseapp.com",
  projectId: "syllogos-map",
  storageBucket: "syllogos-map.firebasestorage.app",
  messagingSenderId: "399287687870",
  appId: "1:399287687870:web:5a1953623334e676af9cef",
};

const app = getApps().find((item) => item.name === "[DEFAULT]") ?? initializeApp(firebaseConfig);
const associationApp = getApps().find((item) => item.name === "association-content")
  ?? initializeApp(associationFirebaseConfig, "association-content");

export const db = getFirestore(app);
export const associationDb = getFirestore(associationApp);

let anonymousUserPromise: Promise<User> | null = null;
let associationAnonymousUserPromise: Promise<User> | null = null;

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

export function ensureAssociationAnonymousUser(): Promise<User> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Firebase Authentication requires a browser."));
  }

  const auth = getAuth(associationApp);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!associationAnonymousUserPromise) {
    associationAnonymousUserPromise = signInAnonymously(auth)
      .then((credential) => credential.user)
      .catch((error) => {
        associationAnonymousUserPromise = null;
        throw error;
      });
  }

  return associationAnonymousUserPromise;
}
