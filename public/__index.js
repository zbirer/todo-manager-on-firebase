import { logInWithGoogle, logOut, monitorAuthState } from './auth.js';

const statusText = document.getElementById('user-status');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

// Attach button actions
loginBtn.addEventListener('click', logInWithGoogle);
logoutBtn.addEventListener('click', logOut);

// Dynamically handle login states
monitorAuthState((uid) => {
  if (uid) {
    statusText.textContent = `Logged in! User UID: ${uid}`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'block';
  } else {
    statusText.textContent = "You are currently signed out.";
    loginBtn.style.display = 'block';
    logoutBtn.style.display = 'none';
  }
});
