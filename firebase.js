// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBHrcjeHumd993-7-oCFlHfWvJfZHP_77E",
  authDomain: "espresso-and-expenses-14371.firebaseapp.com",
  projectId: "espresso-and-expenses-14371",
  storageBucket: "espresso-and-expenses-14371.firebasestorage.app",
  messagingSenderId: "288465891327",
  appId: "1:288465891327:web:a23fc6d2d1a4230c93c1ca",
  measurementId: "G-3J0RXLL8SD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);