import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCoIrB1xjua3hOmzqABbGT2UzRiaJkG7rU",
  authDomain: "animeduel-3c3b6.firebaseapp.com",
  projectId: "animeduel-3c3b6",
  storageBucket: "animeduel-3c3b6.firebasestorage.app",
  messagingSenderId: "940110123360",
  appId: "1:940110123360:web:b11f5ebdee23cce014ce05"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

export { db };