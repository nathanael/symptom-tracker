// Firebase Configuration
export const firebaseConfig = {
  apiKey: "AIzaSyCqkO-WFf7cItkIGRv3iAfH7HDFAN8Ccok",
  authDomain: "symptoms-dae26.firebaseapp.com",
  projectId: "symptoms-dae26",
  storageBucket: "symptoms-dae26.firebasestorage.app",
  messagingSenderId: "469393174412",
  appId: "1:469393174412:web:a40b0fa1239a30091470a9",
  measurementId: "G-DCYZ6J0MPL"
};

// Firebase instance holders
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let googleProvider = null;

// Load Firebase SDK from CDN
export const loadFirebase = () => {
  return new Promise((resolve, reject) => {
    if (window.firebase) {
      resolve(window.firebase);
      return;
    }

    const script1 = document.createElement('script');
    script1.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js';
    script1.onload = () => {
      const script2 = document.createElement('script');
      script2.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js';
      script2.onload = () => {
        const script3 = document.createElement('script');
        script3.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js';
        script3.onload = () => {
          resolve(window.firebase);
        };
        script3.onerror = reject;
        document.head.appendChild(script3);
      };
      script2.onerror = reject;
      document.head.appendChild(script2);
    };
    script1.onerror = reject;
    document.head.appendChild(script1);
  });
};

// Initialize Firebase
export const initFirebase = async () => {
  try {
    const firebase = await loadFirebase();

    if (!firebase.apps.length) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
    } else {
      firebaseApp = firebase.apps[0];
    }

    firebaseAuth = firebase.auth();
    firebaseDb = firebase.firestore();
    googleProvider = new firebase.auth.GoogleAuthProvider();

    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Firestore persistence (IndexedDB) intentionally disabled.
    // The app uses localStorage for all local persistence.
    // Firestore's IndexedDB operations block iOS Safari's main thread
    // for 10-30+ seconds, causing the app to freeze.

    return { auth: firebaseAuth, db: firebaseDb, provider: googleProvider };
  } catch (error) {
    console.error('Failed to load Firebase:', error);
    return null;
  }
};

// Get Firebase instances
export const getFirebaseAuth = () => firebaseAuth;
export const getFirebaseDb = () => firebaseDb;
export const getGoogleProvider = () => googleProvider;

// Check if auth is supported in current environment
export const isAuthSupported = () => {
  const validProtocol = window.location.protocol === 'http:' || window.location.protocol === 'https:';

  let storageAvailable = false;
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    storageAvailable = true;
  } catch (e) {
    storageAvailable = false;
  }

  return validProtocol && storageAvailable;
};
