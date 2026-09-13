const OPERATORS = {
  'nadim.khan': {
    username: 'nadim.khan',
    displayName: 'Nadim Khan',
    role: 'operator',
    roleLabel: 'Computer Operator'
  },
  'shivam.bharti': {
    username: 'shivam.bharti',
    displayName: 'Shivam Kumar Bharti',
    role: 'operator',
    roleLabel: 'Computer Operator'
  }
};

const VALID_PASSWORD = 'Himanshu@123';

export async function login(username, password) {
  const normUser = (username || '').trim().toLowerCase();
  const operator = OPERATORS[normUser];
  if (!operator || password !== VALID_PASSWORD) {
    throw new Error('Invalid username or password.');
  }
  sessionStorage.setItem('dm_operator', JSON.stringify(operator));
  return { operator };
}

export async function startSession() {
  const raw = sessionStorage.getItem('dm_operator');
  if (!raw) {
    if (!location.pathname.endsWith('login.html')) {
      location.replace('./login.html');
    }
    return null;
  }
  try {
    const operator = JSON.parse(raw);
    if (!operator?.username || !OPERATORS[operator.username]) throw new Error();
    document.body.classList.remove('session-checking');
    return operator;
  } catch {
    sessionStorage.removeItem('dm_operator');
    if (!location.pathname.endsWith('login.html')) {
      location.replace('./login.html');
    }
    return null;
  }
}

export async function logout() {
  sessionStorage.removeItem('dm_operator');
  location.replace('./login.html');
}

export async function secureFetch(url, options = {}) {
  return fetch(url, options);
}
