import { logInWithGoogle, logOut, monitorAuthState } from './auth.js';
import { addTodo, fetchUserTodos } from './todoService.js';

// UI Elements
const statusText = document.getElementById('user-status');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const todoSection = document.getElementById('todo-section');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');

let currentUserId = null;

// 1. Render function to build list items dynamically
const renderTodos = (todos) => {
  todoList.innerHTML = ''; // Clear previous items
  todos.forEach((todo) => {
    const li = document.createElement('li');
    li.style.color = todo.colors?.foreground || '#ffffff';
    li.style.backgroundColor = todo.colors?.background || '#3b82f6';
    li.style.padding = '10px';
    li.style.margin = '5px 0';
    li.style.borderRadius = '5px';
    li.style.fontFamily = 'sans-serif';
    
    const tagsString = todo.tags && todo.tags.length > 0 ? ` [${todo.tags.join(', ')}]` : '';
    li.textContent = `${todo.title}${tagsString}`;
    todoList.appendChild(li);
  });
};

// 2. Fetch and render user's todo list
const reloadTodoList = async () => {
  if (!currentUserId) return;
  try {
    const todos = await fetchUserTodos(currentUserId);
    renderTodos(todos);
  } catch (error) {
    console.error("Failed to load todos:", error);
  }
};

// 3. Form Submit Handler to Add a New Todo
todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawTitle = todoInput.value.trim();
  if (!rawTitle || !currentUserId) return;

  try {
    // Basic parser for #tags and @contexts using regex
    const tags = rawTitle.match(/([#@]\w+)/g) || []; 

    await addTodo(currentUserId, {
      title: rawTitle,
      tags: tags,
      colors: { foreground: '#ffffff', background: '#10b981' } // Emerald green default
    });

    todoInput.value = ''; // Clear input field
    await reloadTodoList(); // Instantly refresh the UI
  } catch (error) {
    alert("Could not save task. Please try again.");
  }
});

// 4. Attach event listeners to auth buttons
loginBtn.addEventListener('click', logInWithGoogle);
logoutBtn.addEventListener('click', logOut);

// 5. Monitor Auth State changes
monitorAuthState(async (uid) => {
  currentUserId = uid;
  if (uid) {
    statusText.textContent = "Logged in and sync active.";
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    todoSection.style.display = 'block';
    await reloadTodoList(); // Fetch and show todos on entry
  } else {
    statusText.textContent = "Please sign in to access your task manager.";
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    todoSection.style.display = 'none';
    todoList.innerHTML = ''; // Clear task traces
  }
});
