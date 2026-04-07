type AePanelDeps = {
  socket: any,
};

export function createAePanel(deps: AePanelDeps) {
  deps.socket.on('ae:config', function (cfg: any) {
    (document.getElementById('ae-enabled') as HTMLInputElement).checked = cfg.enabled;
    (document.getElementById('ae-api-url') as HTMLInputElement).value = cfg.apiUrl || '';
    (document.getElementById('ae-api-key') as HTMLInputElement).value = '';
    (document.getElementById('ae-key-status') as HTMLElement).textContent = cfg.hasKey ? '(key is set)' : '(no key set)';
  });

  (document.getElementById('ae-form') as HTMLFormElement).addEventListener('submit', function (e: any) {
    e.preventDefault();
    var keyValue = (document.getElementById('ae-api-key') as HTMLInputElement).value.trim();
    deps.socket.emit('ae:saveConfig', {
      enabled: (document.getElementById('ae-enabled') as HTMLInputElement).checked,
      apiUrl: (document.getElementById('ae-api-url') as HTMLInputElement).value.trim(),
      apiKey: keyValue || '__keep__'
    });
  });

  (document.getElementById('ae-test-btn') as HTMLElement).addEventListener('click', function () {
    (document.getElementById('ae-test-result') as HTMLElement).textContent = 'Testing...';
    (document.getElementById('ae-test-result') as HTMLElement).className = 'test-result';
    deps.socket.emit('ae:testConnection');
  });

  deps.socket.on('ae:testResult', function (result: any) {
    var el = document.getElementById('ae-test-result') as HTMLElement;
    if (result.success) {
      el.textContent = 'Connection successful!';
      el.className = 'test-result test-success';
    } else {
      el.textContent = 'Failed: ' + (result.error || 'Unknown error');
      el.className = 'test-result test-error';
    }
  });
}
