import { useState, useEffect, useRef, useCallback } from 'react';
import { initFirebase, getFirebaseAuth, getFirebaseDb, getGoogleProvider, isAuthSupported } from '../utils/firebase';
import { isStandalone } from '../utils/helpers';

export function useFirebase() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [firebaseError, setFirebaseError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // Initialize Firebase
  useEffect(() => {
    let unsubscribe = null;
    let timeoutId = null;

    const setupFirebase = async () => {
      try {
        timeoutId = setTimeout(() => {
          if (!firebaseReady) {
            setFirebaseError('Firebase blocked - cloud sync unavailable in this environment');
            setAuthLoading(false);
          }
        }, 5000);

        const firebase = await initFirebase();
        clearTimeout(timeoutId);

        if (firebase) {
          setFirebaseReady(true);

          try {
            const result = await firebase.auth.getRedirectResult();
            if (result.user) {
              console.log('Redirect sign-in successful');
            }
          } catch (redirectError) {
            console.log('No redirect result or error:', redirectError.message);
          }

          unsubscribe = firebase.auth.onAuthStateChanged(async (firebaseUser) => {
            setUser(firebaseUser);
            setAuthLoading(false);
          });
        } else {
          setFirebaseError('Firebase failed to initialize');
          setAuthLoading(false);
        }
      } catch (error) {
        console.error('Firebase setup error:', error);
        setFirebaseError(error.message);
        setAuthLoading(false);
      }
    };

    setupFirebase();

    return () => {
      if (unsubscribe) unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Save to Cloud
  const saveToCloud = useCallback(async (data) => {
    const firebaseDb = getFirebaseDb();
    if (!user || !firebaseDb) return;

    setSyncing(true);
    setSyncError(null);

    try {
      await firebaseDb.collection('users').doc(user.uid).set({
        ...data,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        version: '3.4',
      });
      setLastSynced(new Date());
    } catch (error) {
      console.error('Error saving to cloud:', error);
      if (error.message?.includes('offline') || error.code === 'unavailable') {
        // Don't set error for offline
      } else if (error.code === 'not-found') {
        setSyncError('Database not set up. Create Firestore database in Firebase Console.');
      } else if (error.code === 'permission-denied') {
        setSyncError('Permission denied. Check Firestore security rules.');
      } else {
        setSyncError(error.message);
      }
    } finally {
      setSyncing(false);
    }
  }, [user]);

  // Load from Cloud
  const loadFromCloud = useCallback(async () => {
    const firebaseDb = getFirebaseDb();
    if (!user || !firebaseDb) return null;

    setSyncing(true);
    setSyncError(null);

    try {
      const docSnap = await firebaseDb.collection('users').doc(user.uid).get();

      if (docSnap.exists) {
        const data = docSnap.data();
        setLastSynced(data.updatedAt?.toDate() || new Date());
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error loading from cloud:', error);
      if (!error.message?.includes('offline') && error.code !== 'unavailable') {
        setSyncError(error.message);
      }
      return null;
    } finally {
      setSyncing(false);
    }
  }, [user]);

  // Sign In with Google
  const signInWithGoogle = useCallback(async () => {
    const firebaseAuth = getFirebaseAuth();
    const googleProvider = getGoogleProvider();

    if (!firebaseAuth || !googleProvider) {
      setSyncError('Firebase not loaded');
      return;
    }

    if (!isAuthSupported()) {
      if (window.location.protocol === 'file:') {
        setSyncError('Cannot sign in from local file. Deploy to a web server.');
      } else {
        setSyncError('Sign-in not supported in this environment.');
      }
      return;
    }

    if (isStandalone()) {
      setSyncError('Google Sign-In is not available in home screen mode. Use email sign-in above.');
      return;
    }

    try {
      setSyncing(true);
      setSyncError(null);

      try {
        const result = await firebaseAuth.signInWithPopup(googleProvider);
        if (result.user) {
          setUser(result.user);
        }
      } catch (popupError) {
        if (popupError.code === 'auth/popup-blocked') {
          await firebaseAuth.signInWithRedirect(googleProvider);
        } else {
          throw popupError;
        }
      }
    } catch (error) {
      console.error('Sign in error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setSyncError('Sign-in cancelled');
      } else if (error.code === 'auth/operation-not-supported-in-this-environment') {
        setSyncError('Google Sign-In unavailable in this mode. Try email sign-in instead.');
      } else if (error.code !== 'auth/cancelled-popup-request') {
        setSyncError(error.message);
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  // Sign In with Email
  const signInWithEmail = useCallback(async (email, password, isSignUp) => {
    const firebaseAuth = getFirebaseAuth();

    if (!firebaseAuth) {
      setSyncError('Firebase not loaded');
      return false;
    }

    if (!email || !password) {
      setSyncError('Please enter email and password');
      return false;
    }

    if (password.length < 6) {
      setSyncError('Password must be at least 6 characters');
      return false;
    }

    try {
      setSyncing(true);
      setSyncError(null);

      let result;
      if (isSignUp) {
        result = await firebaseAuth.createUserWithEmailAndPassword(email, password);
      } else {
        result = await firebaseAuth.signInWithEmailAndPassword(email, password);
      }

      if (result.user) {
        setUser(result.user);
        return true;
      }
    } catch (error) {
      console.error('Email sign in error:', error);

      if (error.code === 'auth/user-not-found') {
        setSyncError('No account with this email. Tap "Create account" to sign up.');
      } else if (error.code === 'auth/wrong-password') {
        setSyncError('Incorrect password');
      } else if (error.code === 'auth/email-already-in-use') {
        setSyncError('Account exists. Tap "Sign in" instead.');
      } else if (error.code === 'auth/invalid-email') {
        setSyncError('Invalid email address');
      } else if (error.code === 'auth/weak-password') {
        setSyncError('Password must be at least 6 characters');
      } else if (error.code === 'auth/too-many-requests') {
        setSyncError('Too many attempts. Try again later.');
      } else if (error.code === 'auth/invalid-credential') {
        setSyncError('Invalid email or password');
      } else {
        setSyncError(error.message);
      }
    } finally {
      setSyncing(false);
    }

    return false;
  }, []);

  // Forgot Password
  const forgotPassword = useCallback(async (email) => {
    const firebaseAuth = getFirebaseAuth();

    if (!firebaseAuth) {
      setSyncError('Firebase not loaded');
      return false;
    }

    if (!email) {
      setSyncError('Enter your email address first');
      return false;
    }

    try {
      setSyncing(true);
      setSyncError(null);
      await firebaseAuth.sendPasswordResetEmail(email);
      return true;
    } catch (error) {
      console.error('Password reset error:', error);
      if (error.code === 'auth/user-not-found') {
        setSyncError('No account with this email. Create one first.');
      } else if (error.code === 'auth/invalid-email') {
        setSyncError('Invalid email address');
      } else if (error.code === 'auth/too-many-requests') {
        setSyncError('Too many attempts. Try again later.');
      } else {
        setSyncError(error.message);
      }
    } finally {
      setSyncing(false);
    }

    return false;
  }, []);

  // Listen to cloud changes in real-time
  const listenToCloud = useCallback((onData) => {
    const firebaseDb = getFirebaseDb();
    if (!user || !firebaseDb) return null;

    return firebaseDb.collection('users').doc(user.uid).onSnapshot(
      (docSnap) => {
        if (docSnap.exists) {
          const data = docSnap.data();
          setLastSynced(data.updatedAt?.toDate() || new Date());
          onData(data);
        }
      },
      (error) => {
        console.error('Cloud listener error:', error);
        if (!error.message?.includes('offline') && error.code !== 'unavailable') {
          setSyncError(error.message);
        }
      }
    );
  }, [user]);

  // Sign Out
  const signOut = useCallback(async () => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) return;

    try {
      await firebaseAuth.signOut();
      setLastSynced(null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }, []);

  return {
    user,
    authLoading,
    firebaseReady,
    firebaseError,
    syncing,
    lastSynced,
    syncError,
    setSyncError,
    saveToCloud,
    loadFromCloud,
    listenToCloud,
    signInWithGoogle,
    signInWithEmail,
    forgotPassword,
    signOut,
  };
}
