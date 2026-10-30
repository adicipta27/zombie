// firebase-config.js - Pusat Konfigurasi, Auth, & Database Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { 
    getDatabase, 
    ref, 
    set, 
    get, 
    update, 
    onValue, 
    push, 
    remove 
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";

// Konfigurasi Firebase dari akunmu
const firebaseConfig = {
    apiKey: "AIzaSyC8_4KIQ5XCNTwi-ibqbxnEtLLhw-2ccg8",
    authDomain: "zombie-c232c.firebaseapp.com",
    projectId: "zombie-c232c",
    storageBucket: "zombie-c232c.firebasestorage.app",
    messagingSenderId: "930642302129",
    appId: "1:930642302129:web:1ddf36a1efe242450c7e90"
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { 
    auth, 
    db, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged, 
    ref, 
    set, 
    get, 
    update, 
    onValue, 
    push, 
    remove 
};
