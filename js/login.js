import { login } from './auth-client.js';

const form = document.querySelector('form');
const submit = form.querySelector('button');
const error = document.querySelector('.error');

document.querySelectorAll('[data-user]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-user]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  form.elements.username.value = button.dataset.user;
  form.elements.password.value = '';
  error.textContent = '';
  form.elements.password.focus();
}));

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  error.textContent = '';
  const username = form.elements.username.value;
  const password = form.elements.password.value;

  try {
    await login(username, password);
    form.elements.password.value = '';
    location.replace('./index.html#dashboard');
  } catch (err) {
    error.textContent = err.message || 'Invalid username or password.';
    form.elements.password.value = '';
    submit.disabled = false;
  }
});
