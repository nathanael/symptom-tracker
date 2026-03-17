import { useState, useEffect, useCallback } from 'react';
import { initFirebase, getFirebaseAuth, getGoogleProvider, isAuthSupported } from '../utils/firebase';
import { isStandalone } from '../utils/helpers';

export function useFirebase() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [firebaseError, setFirebaseError] = useState(null);
  const [authError, setAuthError] = useState(null);

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

  // Sign In with Google
  const signInWithGoogle = useCallback(async () => {
    const firebaseAuth = getFirebaseAuth();
    const googleProvider = getGoogleProvider();

    if (!firebaseAuth || !googleProvider) {
      setAuthError('Firebase not loaded');
      return;
    }

    if (!isAuthSupported()) {
      if (window.location.protocol === 'file:') {
        setAuthError('Cannot sign in from local file. Deploy to a web server.');
      } else {
        setAuthError('Sign-in not supported in this environment.');
      }
      return;
    }

    if (isStandalone()) {
      setAuthError('Google Sign-In is not available in home screen mode. Use email sign-in above.');
      return;
    }

    try {
      setAuthError(null);
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
        setAuthError('Sign-in cancelled');
      } else if (error.code === 'auth/operation-not-supported-in-this-environment') {
        setAuthError('Google Sign-In unavailable in this mode. Try email sign-in instead.');
      } else if (error.code !== 'auth/cancelled-popup-request') {
        setAuthError(error.message);
      }
    }
  }, []);

  // Sign In with Email
  const signInWithEmail = useCallback(async (email, password, isSignUp) => {
    const firebaseAuth = getFirebaseAuth();

    if (!firebaseAuth) {
      setAuthError('Firebase not loaded');
      return false;
    }

    if (!email || !password) {
      setAuthError('Please enter email and password');
      return false;
    }

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters');
      return false;
    }

    try {
      setAuthError(null);
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
        setAuthError('No account with this email. Tap "Create account" to sign up.');
      } else if (error.code === 'auth/wrong-password') {
        setAuthError('Incorrect password');
      } else if (error.code === 'auth/email-already-in-use') {
        setAuthError('Account exists. Tap "Sign in" instead.');
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('Invalid email address');
      } else if (error.code === 'auth/weak-password') {
        setAuthError('Password must be at least 6 characters');
      } else if (error.code === 'auth/too-many-requests') {
        setAuthError('Too many attempts. Try again later.');
      } else if (error.code === 'auth/invalid-credential') {
        setAuthError('Invalid email or password');
      } else {
        setAuthError(error.message);
      }
    }

    return false;
  }, []);

  // Forgot Password
  const forgotPassword = useCallback(async (email) => {
    const firebaseAuth = getFirebaseAuth();

    if (!firebaseAuth) {
      setAuthError('Firebase not loaded');
      return false;
    }

    if (!email) {
      setAuthError('Enter your email address first');
      return false;
    }

    try {
      setAuthError(null);
      await firebaseAuth.sendPasswordResetEmail(email);
      return true;
    } catch (error) {
      console.error('Password reset error:', error);
      if (error.code === 'auth/user-not-found') {
        setAuthError('No account with this email. Create one first.');
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('Invalid email address');
      } else if (error.code === 'auth/too-many-requests') {
        setAuthError('Too many attempts. Try again later.');
      } else {
        setAuthError(error.message);
      }
    }

    return false;
  }, []);

  // Sign Out
  const signOut = useCallback(async () => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) return;

    try {
      await firebaseAuth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }, []);

  return {
    user,
    authLoading,
    firebaseReady,
    firebaseError,
    authError,
    setAuthError,
    signInWithGoogle,
    signInWithEmail,
    forgotPassword,
    signOut,
  };
}
