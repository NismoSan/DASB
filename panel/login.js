"use strict";
(() => {
  // src/panel/login.ts
  var loginForm = document.getElementById("loginForm");
  var loginButton = document.getElementById("loginBtn");
  var loginError = document.getElementById("loginError");
  var usernameInput = document.getElementById("username");
  var passwordInput = document.getElementById("password");
  if (loginForm && loginButton && loginError && usernameInput && passwordInput) {
    loginForm.addEventListener("submit", function(event) {
      event.preventDefault();
      loginButton.disabled = true;
      loginError.classList.remove("visible");
      fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      }).then(function(response) {
        if (response.ok) {
          window.location.href = "/";
          return null;
        }
        return response.json().then(function(data) {
          loginError.textContent = data.error || "Login failed";
          loginError.classList.add("visible");
          loginButton.disabled = false;
          return null;
        });
      }).catch(function() {
        loginError.textContent = "Connection error. Please try again.";
        loginError.classList.add("visible");
        loginButton.disabled = false;
      });
    });
  }
})();
