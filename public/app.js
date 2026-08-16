import { logInWithGoogle, logOut, monitorAuthState } from './auth.js';
import { addTodo, fetchUserTodos } from './todoService.js';

// 1. Get DOM elements
const statusText = document.getElementById('user-status');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const todoSection = document.getElementById('todo-section');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');

let currentUserId = null;

// 2. Render tasks to the UI
const renderTodos = (todos) => {
  todoList.innerHTML = ''; // Clear previous tasks
  todos.forEach((todo) => {
    const li = document.createElement('li');
    li.style.color = todo.colors?.foreground || '#ffffff';
    li.style.backgroundColor = todo.colors?.background || '#3b82f6';
    li.style.padding = '10px';
    li.style.margin = '5px 0';
    li.style.borderRadius = '4px';
    li.style.fontFamily = 'sans-serif';
    
    const tagsString = todo.tags && todo.tags.length > 0 ? ` [${todo.tags.join(', ')}]` : '';
    li.textContent = `${todo.title}${tagsString}`;
    todoList.appendChild(li);
  });
};

// 3. Fetch and reload the todo list
const reloadTodoList = async () => {
  if (!currentUserId) return;
  try {
    const todos = await fetchUserTodos(currentUserId);
    renderTodos(todos);
  } catch (error) {
    console.error("Failed to load todos:", error);
  }
};

// 4. Form Submission: Parse tags & save to Firestore
todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawTitle = todoInput.value.trim();
  if (!rawTitle || !currentUserId) return;

  try {
    // Automatically extract #tags and @contexts
    const tags = rawTitle.match(/([#@]\w+)/g) || [];

    await addTodo(currentUserId, {
      title: rawTitle,
      tags: tags,
      colors: { foreground: '#ffffff', background: '#10b981' } // green styling
    });

    todoInput.value = ''; // Reset input
    await reloadTodoList(); // Re-render list
  } catch (error) {
    alert("Could not add todo.");
  }
});

// 5. Connect login/logout buttons
loginBtn.addEventListener('click', logInWithGoogle);
logoutBtn.addEventListener('click', logOut);

// 6. Monitor auth state (triggers on page load & sign-in changes)
monitorAuthState(async (uid) => {
  currentUserId = uid;
  if (uid) {
    statusText.textContent = "Sync active!";
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    todoSection.style.display = 'block';
    await reloadTodoList();
  } else {
    statusText.textContent = "Please sign in to access your task manager.";
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    todoSection.style.display = 'none';
    todoList.innerHTML = '';
  }
});
