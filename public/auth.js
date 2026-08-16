import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your Web App's Firebase configuration
// (Replace "YOUR_API_KEY" and "YOUR_APP_ID" with values from your Firebase Console)
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAp059i2QlT0S3CawXY6urSBDOeIrjHu94",
  authDomain: "todo-manager-1f96e.firebaseapp.com",
  projectId: "todo-manager-1f96e",
  storageBucket: "todo-manager-1f96e.firebasestorage.app",
  messagingSenderId: "378286017601",
  appId: "1:378286017601:web:154004d6a872bbcf4a8ac0",
  measurementId: "G-26B170XMVV"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize and export services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Google Authentication Provider Setup
const provider = new GoogleAuthProvider();

// 1. Function to trigger Google Sign-In Popup
export const logInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    console.log("Successfully logged in:", result.user.displayName);
    console.log("Logged in user UID:", result.user.uid); // <-- This line prints your UID!
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};


// 2. Function to log out
export const logOut = async () => {
  try {
    await signOut(auth);
    console.log("Successfully logged out.");
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};

// 3. Observer to track active user state and retrieve their UID
export const monitorAuthState = (onUserChanged) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onUserChanged(user.uid);
    } else {
      onUserChanged(null);
    }
  });
};
