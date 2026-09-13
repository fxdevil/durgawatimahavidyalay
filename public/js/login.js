const form = document.querySelector('form');
const submit = form.querySelector('button');
const error = document.querySelector('.error');
document.querySelectorAll('[data-user]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-user]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  form.elements.username.value = button.dataset.user; form.elements.password.value = ''; error.textContent = ''; form.elements.password.focus();
}));
form.addEventListener('submit', async event => {
  event.preventDefault(); submit.disabled = true; error.textContent = '';
  const username = form.elements.username.value, password = form.elements.password.value;
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!response.ok) throw new Error();
    form.elements.password.value = ''; location.replace('/#dashboard');
  } catch { error.textContent = 'Invalid username or password.'; form.elements.password.value = ''; submit.disabled = false; }
});
