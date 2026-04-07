const loginForm = document.getElementById('loginForm') as HTMLFormElement | null;
const loginButton = document.getElementById('loginBtn') as HTMLButtonElement | null;
const loginError = document.getElementById('loginError') as HTMLDivElement | null;
const usernameInput = document.getElementById('username') as HTMLInputElement | null;
const passwordInput = document.getElementById('password') as HTMLInputElement | null;

if (loginForm && loginButton && loginError && usernameInput && passwordInput) {
  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loginButton.disabled = true;
    loginError.classList.remove('visible');

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value
      })
    })
      .then(function (response) {
        if (response.ok) {
          window.location.href = '/';
          return null;
        }
        return response.json().then(function (data: any) {
          loginError.textContent = data.error || 'Login failed';
          loginError.classList.add('visible');
          loginButton.disabled = false;
          return null;
        });
      })
      .catch(function () {
        loginError.textContent = 'Connection error. Please try again.';
        loginError.classList.add('visible');
        loginButton.disabled = false;
      });
  });
}
