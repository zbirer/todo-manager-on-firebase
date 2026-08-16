import { collection, addDoc, getDocs, serverTimestamp, query, orderBy } from "firebase/firestore";
import { db } from "./auth.js"; // Import the db instance we initialized in auth.js

// 1. Add a todo to a user's isolated subcollection
export const addTodo = async (userId, todoDetails) => {
  try {
    // Reference points to: users/{userId}/todos
    const todosCollectionRef = collection(db, "users", userId, "todos");

    const newTodo = {
      title: todoDetails.title,
      completed: false,
      parentTaskId: todoDetails.parentTaskId || null, // For task hierarchy
      tags: todoDetails.tags || [],                 // e.g., ["#private", "@office"]
      colors: {
        foreground: todoDetails.colors?.foreground || "#000000",
        background: todoDetails.colors?.background || "#ffffff"
      },
      createdAt: serverTimestamp(),                 // Track task age
      dueDate: todoDetails.dueDate ? new Date(todoDetails.dueDate) : null
    };

    const docRef = await addDoc(todosCollectionRef, newTodo);
    console.log("Document written with ID: ", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Error adding document: ", error);
    throw error;
  }
};

// 2. Fetch all todos for a specific user
export const fetchUserTodos = async (userId) => {
  try {
    const todosCollectionRef = collection(db, "users", userId, "todos");
    const q = query(todosCollectionRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const todos = [];
    querySnapshot.forEach((doc) => {
      todos.push({ id: doc.id, ...doc.data() });
    });
    return todos;
  } catch (error) {
    console.error("Error fetching documents: ", error);
    throw error;
  }
};
