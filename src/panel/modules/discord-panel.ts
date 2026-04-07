import { escapeHtml } from './text';

type DiscordPanelDeps = {
  socket: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createDiscordPanel(deps: DiscordPanelDeps) {
  var discordRules: any[] = [];

  function renderDiscordRules(rules: any[]) {
    discordRules = rules || [];
    var container = document.getElementById('discord-rules-list') as HTMLElement;

    if (discordRules.length === 0) {
      container.innerHTML = '<div class="rules-empty">No webhook rules configured yet.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < discordRules.length; i++) {
      var r = discordRules[i];
      var typesStr = (r.messageTypes || []).join(', ');
      html +=
        '<div class="rule-item' + (r.enabled ? ' rule-enabled' : ' rule-disabled') + '" data-rule-id="' + escapeHtml(r.id) + '">' +
          '<div class="rule-header">' +
            '<label class="rule-toggle"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' data-toggle-id="' + escapeHtml(r.id) + '" /> ' +
            '<span class="rule-name">' + escapeHtml(r.name || 'Unnamed') + '</span></label>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small rule-edit-btn" data-edit-idx="' + i + '">Edit</button>' +
              '<button class="btn btn-small btn-red rule-delete-btn" data-delete-id="' + escapeHtml(r.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">' + escapeHtml(typesStr) + '</span>' +
            (r.pattern ? '<span class="rule-pattern">/' + escapeHtml(r.pattern) + '/i</span>' : '') +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('input[data-toggle-id]').forEach(function (cb: any) {
      cb.addEventListener('change', function () {
        deps.socket.emit('discord:toggleRule', { id: cb.dataset.toggleId, enabled: cb.checked });
      });
    });

    container.querySelectorAll('.rule-edit-btn').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.editIdx, 10);
        loadRuleIntoForm(discordRules[idx]);
      });
    });

    container.querySelectorAll('.rule-delete-btn').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        deps.socket.emit('discord:deleteRule', { id: btn.dataset.deleteId });
      });
    });
  }

  function loadRuleIntoForm(rule: any) {
    (document.getElementById('dr-id') as HTMLInputElement).value = rule.id || '';
    (document.getElementById('dr-name') as HTMLInputElement).value = rule.name || '';
    (document.getElementById('dr-bot-name') as HTMLInputElement).value = rule.botName || '';
    (document.getElementById('dr-webhook-url') as HTMLInputElement).value = rule.webhookUrl || '';
    (document.getElementById('dr-pattern') as HTMLInputElement).value = rule.pattern || '';

    document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]').forEach(function (cb: any) {
      cb.checked = false;
    });

    var types = rule.messageTypes || [];
    var typeMap: Record<string, string> = {
      'Any': 'dr-type-any',
      'WorldMessage (All)': 'dr-type-world-all',
      'WorldShout': 'dr-type-worldshout',
      'WorldMessage': 'dr-type-worldmessage',
      'WhisperReceived': 'dr-type-whisper',
      'Whisper': 'dr-type-whisper-sent',
      'GuildMessage': 'dr-type-guild',
      'PublicMessage': 'dr-type-public'
    };
    for (var t = 0; t < types.length; t++) {
      var elId = typeMap[types[t]];
      if (elId) {
        var el = document.getElementById(elId) as HTMLInputElement | null;
        if (el) el.checked = true;
      }
    }
  }

  function clearRuleForm() {
    (document.getElementById('dr-id') as HTMLInputElement).value = '';
    (document.getElementById('dr-name') as HTMLInputElement).value = '';
    (document.getElementById('dr-bot-name') as HTMLInputElement).value = '';
    (document.getElementById('dr-webhook-url') as HTMLInputElement).value = '';
    (document.getElementById('dr-pattern') as HTMLInputElement).value = '';
    document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]').forEach(function (cb: any) {
      cb.checked = false;
    });
    (document.getElementById('discord-test-result') as HTMLElement).textContent = '';
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  deps.socket.on('discord:rules', function (rules: any[]) {
    renderDiscordRules(rules);
  });

  (document.getElementById('discord-rule-form') as HTMLFormElement).addEventListener('submit', function (e: any) {
    e.preventDefault();

    var id = (document.getElementById('dr-id') as HTMLInputElement).value.trim();
    if (!id) id = generateId();

    var selectedTypes: string[] = [];
    document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]:checked').forEach(function (cb: any) {
      selectedTypes.push(cb.value);
    });

    var rule: any = {
      id: id,
      name: (document.getElementById('dr-name') as HTMLInputElement).value.trim() || 'Unnamed',
      enabled: true,
      webhookUrl: (document.getElementById('dr-webhook-url') as HTMLInputElement).value.trim(),
      messageTypes: selectedTypes,
      pattern: (document.getElementById('dr-pattern') as HTMLInputElement).value.trim() || null,
      botName: (document.getElementById('dr-bot-name') as HTMLInputElement).value.trim() || 'DASB',
      botAvatar: null
    };

    for (var i = 0; i < discordRules.length; i++) {
      if (discordRules[i].id === rule.id) {
        rule.enabled = discordRules[i].enabled;
        break;
      }
    }

    if (!rule.webhookUrl) {
      deps.showToast('Webhook URL is required', true);
      return;
    }
    if (selectedTypes.length === 0) {
      deps.showToast('Select at least one message type', true);
      return;
    }

    deps.socket.emit('discord:saveRule', rule);
    clearRuleForm();
  });

  (document.getElementById('dr-clear-btn') as HTMLElement).addEventListener('click', function () {
    clearRuleForm();
  });

  (document.getElementById('dr-test-btn') as HTMLElement).addEventListener('click', function () {
    var url = (document.getElementById('dr-webhook-url') as HTMLInputElement).value.trim();
    var botName = (document.getElementById('dr-bot-name') as HTMLInputElement).value.trim() || 'DASB';
    if (!url) {
      deps.showToast('Enter a webhook URL first', true);
      return;
    }
    (document.getElementById('discord-test-result') as HTMLElement).textContent = 'Testing...';
    (document.getElementById('discord-test-result') as HTMLElement).className = 'test-result';
    deps.socket.emit('discord:testWebhook', { url: url, botName: botName });
  });

  deps.socket.on('discord:testResult', function (result: any) {
    var el = document.getElementById('discord-test-result') as HTMLElement;
    if (result.success) {
      el.textContent = 'Webhook test successful!';
      el.className = 'test-result test-success';
    } else {
      el.textContent = 'Failed: ' + (result.error || 'Unknown error');
      el.className = 'test-result test-error';
    }
  });
}
