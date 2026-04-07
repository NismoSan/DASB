import { escapeHtml } from './text';

type ConfigPanelDeps = {
  socket: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createConfigPanel(deps: ConfigPanelDeps) {
  var currentConfigBots: any[] = [];

  function renderBotConfigRows(botsList: any[]) {
    currentConfigBots = botsList || [];
    var container = document.getElementById('bot-config-list') as HTMLElement;
    var html = '';
    for (var i = 0; i < currentConfigBots.length; i++) {
      var b = currentConfigBots[i];
      html += '<div class="bot-config-row" data-idx="' + i + '">' +
        '<span class="bot-config-num">' + (i + 1) + '</span>' +
        '<input type="text" class="cfg-bot-username" value="' + escapeHtml(b.username || '') + '" placeholder="Username" autocomplete="off" />' +
        '<input type="password" class="cfg-bot-password" value="' + escapeHtml(b.password || '') + '" placeholder="Password" autocomplete="off" />' +
        '<label class="toolbar-check"><input type="checkbox" class="cfg-bot-enabled" ' + (b.enabled !== false ? 'checked' : '') + ' /> On</label>' +
        '<select class="cfg-bot-role toolbar-select" style="width:auto;min-width:90px;font-size:12px;padding:2px 4px;">' +
          '<option value="secondary"' + (b.role === 'secondary' || !b.role ? ' selected' : '') + '>Secondary</option>' +
          '<option value="primary"' + (b.role === 'primary' ? ' selected' : '') + '>Primary</option>' +
          '<option value="lottery"' + (b.role === 'lottery' ? ' selected' : '') + '>Lottery</option>' +
          '<option value="tracker"' + (b.role === 'tracker' ? ' selected' : '') + '>Tracker</option>' +
          '<option value="sense"' + (b.role === 'sense' ? ' selected' : '') + '>Sense</option>' +
          '<option value="trader"' + (b.role === 'trader' ? ' selected' : '') + '>Trader</option>' +
          '<option value="leak"' + (b.role === 'leak' ? ' selected' : '') + '>Leak Scanner</option>' +
          '<option value="slots"' + (b.role === 'slots' ? ' selected' : '') + '>Slot Machine</option>' +
        '</select>' +
        '<button type="button" class="btn btn-small btn-red cfg-bot-remove" data-idx="' + i + '">X</button>' +
      '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cfg-bot-remove').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.idx, 10);
        currentConfigBots.splice(idx, 1);
        renderBotConfigRows(currentConfigBots);
      });
    });

    var addBtn = document.getElementById('btn-add-bot') as HTMLElement | null;
    if (addBtn) {
      addBtn.style.display = '';
    }
  }

  (document.getElementById('btn-add-bot') as HTMLElement).addEventListener('click', function () {
    currentConfigBots.push({
      id: 'bot_' + Date.now().toString(36),
      username: '',
      password: '',
      enabled: true,
      role: currentConfigBots.length === 0 ? 'primary' : 'secondary'
    });
    renderBotConfigRows(currentConfigBots);
  });

  deps.socket.on('config:data', function (config: any) {
    renderBotConfigRows(config.bots || []);

    (document.getElementById('cfg-server-address') as HTMLInputElement).value = (config.server && config.server.address) || '';
    (document.getElementById('cfg-server-port') as HTMLInputElement).value = (config.server && config.server.port) || 2610;
    (document.getElementById('cfg-web-port') as HTMLInputElement).value = config.webPort || 3000;
    (document.getElementById('cfg-auto-reconnect') as HTMLInputElement).checked = config.features ? config.features.autoReconnect !== false : true;
    (document.getElementById('cfg-log-chat') as HTMLInputElement).checked = config.features ? config.features.logChat !== false : true;
    (document.getElementById('cfg-log-packets') as HTMLInputElement).checked = config.features ? config.features.logPackets !== false : true;

    var rs = config.reconnectStrategy || {};
    (document.getElementById('cfg-sequential-reconnect') as HTMLInputElement).checked = rs.sequential !== false;
    (document.getElementById('cfg-reconnect-delay') as HTMLInputElement).value = rs.delayBetweenBots || 5000;

    (document.getElementById('cfg-walk-paths') as HTMLTextAreaElement).value = JSON.stringify(config.walkPaths || [], null, 2);
    (document.getElementById('cfg-timezone') as HTMLSelectElement).value = config.timezone || 'America/Chicago';

    var proxy = config.proxy || {};
    (document.getElementById('cfg-proxy-enabled') as HTMLInputElement).checked = !!proxy.enabled;
    (document.getElementById('cfg-proxy-log') as HTMLInputElement).checked = proxy.logPackets !== false;
    (document.getElementById('cfg-proxy-public-address') as HTMLInputElement).value = proxy.publicAddress || '';
    (document.getElementById('cfg-proxy-listen-port') as HTMLInputElement).value = proxy.listenPort || 2610;
    (document.getElementById('cfg-proxy-game-port1') as HTMLInputElement).value = proxy.gamePort1 || 2611;
    (document.getElementById('cfg-proxy-game-port2') as HTMLInputElement).value = proxy.gamePort2 || 2612;
    (document.getElementById('cfg-proxy-real-address') as HTMLInputElement).value = proxy.realServerAddress || '';
    (document.getElementById('cfg-proxy-real-port') as HTMLInputElement).value = proxy.realLoginPort || 2610;

    var monsters = proxy.monsters || {};
    (document.getElementById('cfg-monsters-enabled') as HTMLInputElement).checked = !!monsters.enabled;
    (document.getElementById('cfg-monsters-encounter-map') as HTMLInputElement).value = monsters.encounterMapNumber || 449;
    (document.getElementById('cfg-monsters-encounter-rate') as HTMLInputElement).value = '' + (monsters.encounterRate ? Math.round(monsters.encounterRate * 100) : 15);
    (document.getElementById('cfg-monsters-max') as HTMLInputElement).value = monsters.maxMonsters || 6;
    (document.getElementById('cfg-monsters-cooldown') as HTMLInputElement).value = monsters.companionCastCooldownMs || 6000;
    (document.getElementById('cfg-monsters-keeper-map') as HTMLInputElement).value = monsters.keeperMapNumber || 449;
    (document.getElementById('cfg-monsters-keeper-x') as HTMLInputElement).value = monsters.keeperX || 5;
    (document.getElementById('cfg-monsters-keeper-y') as HTMLInputElement).value = monsters.keeperY || 5;
    (document.getElementById('cfg-monsters-keeper-sprite') as HTMLInputElement).value = monsters.keeperSprite || 1;
    (document.getElementById('cfg-monsters-keeper-name') as HTMLInputElement).value = monsters.keeperName || 'Monster Keeper';

    var nameTags = proxy.nameTags || {};
    (document.getElementById('cfg-nametags-enabled') as HTMLInputElement).checked = nameTags.enabled !== false;
    (document.getElementById('cfg-nametags-style') as HTMLInputElement).value = nameTags.nameStyle != null ? nameTags.nameStyle : 3;
  });

  (document.getElementById('config-form') as HTMLFormElement).addEventListener('submit', function (e: any) {
    e.preventDefault();

    var rows = document.querySelectorAll('.bot-config-row');
    var botsArr: any[] = [];

    rows.forEach(function (row: any, i: number) {
      var username = row.querySelector('.cfg-bot-username').value.trim();
      var password = row.querySelector('.cfg-bot-password').value.trim();
      var enabled = row.querySelector('.cfg-bot-enabled').checked;
      var role = row.querySelector('.cfg-bot-role').value || 'secondary';
      var existingBot = currentConfigBots[i] || {};

      botsArr.push({
        id: existingBot.id || 'bot_' + Date.now().toString(36) + i,
        username: username,
        password: password,
        enabled: enabled,
        role: role
      });
    });

    var usernames = botsArr.map(function (b) { return b.username.toLowerCase(); }).filter(function (u) { return u; });
    var uniqueUsernames = usernames.filter(function (u, i) { return usernames.indexOf(u) === i; });
    if (uniqueUsernames.length !== usernames.length) {
      deps.showToast('Bot usernames must be unique', true);
      return;
    }

    var walkPaths = [];
    try {
      walkPaths = JSON.parse((document.getElementById('cfg-walk-paths') as HTMLTextAreaElement).value || '[]');
    } catch (err) {
      deps.showToast('Invalid JSON in Walk Paths field', true);
      return;
    }

    deps.socket.emit('config:save', {
      bots: botsArr,
      server: {
        address: (document.getElementById('cfg-server-address') as HTMLInputElement).value,
        port: parseInt((document.getElementById('cfg-server-port') as HTMLInputElement).value, 10) || 2610
      },
      webPort: parseInt((document.getElementById('cfg-web-port') as HTMLInputElement).value, 10) || 3000,
      features: {
        autoReconnect: (document.getElementById('cfg-auto-reconnect') as HTMLInputElement).checked,
        logChat: (document.getElementById('cfg-log-chat') as HTMLInputElement).checked,
        logPackets: (document.getElementById('cfg-log-packets') as HTMLInputElement).checked
      },
      reconnectStrategy: {
        sequential: (document.getElementById('cfg-sequential-reconnect') as HTMLInputElement).checked,
        delayBetweenBots: parseInt((document.getElementById('cfg-reconnect-delay') as HTMLInputElement).value, 10) || 5000
      },
      walkPaths: walkPaths,
      timezone: (document.getElementById('cfg-timezone') as HTMLSelectElement).value,
      proxy: {
        enabled: (document.getElementById('cfg-proxy-enabled') as HTMLInputElement).checked,
        listenPort: parseInt((document.getElementById('cfg-proxy-listen-port') as HTMLInputElement).value, 10) || 2610,
        gamePort1: parseInt((document.getElementById('cfg-proxy-game-port1') as HTMLInputElement).value, 10) || 2611,
        gamePort2: parseInt((document.getElementById('cfg-proxy-game-port2') as HTMLInputElement).value, 10) || 2612,
        publicAddress: (document.getElementById('cfg-proxy-public-address') as HTMLInputElement).value.trim(),
        realServerAddress: (document.getElementById('cfg-proxy-real-address') as HTMLInputElement).value.trim() || '',
        realLoginPort: parseInt((document.getElementById('cfg-proxy-real-port') as HTMLInputElement).value, 10) || 2610,
        logPackets: (document.getElementById('cfg-proxy-log') as HTMLInputElement).checked,
        monsters: {
          enabled: (document.getElementById('cfg-monsters-enabled') as HTMLInputElement).checked,
          encounterMapNumber: parseInt((document.getElementById('cfg-monsters-encounter-map') as HTMLInputElement).value, 10) || 449,
          encounterRate: (parseInt((document.getElementById('cfg-monsters-encounter-rate') as HTMLInputElement).value, 10) || 15) / 100,
          maxMonsters: parseInt((document.getElementById('cfg-monsters-max') as HTMLInputElement).value, 10) || 6,
          companionCastCooldownMs: parseInt((document.getElementById('cfg-monsters-cooldown') as HTMLInputElement).value, 10) || 6000,
          keeperMapNumber: parseInt((document.getElementById('cfg-monsters-keeper-map') as HTMLInputElement).value, 10) || 449,
          keeperX: parseInt((document.getElementById('cfg-monsters-keeper-x') as HTMLInputElement).value, 10) || 5,
          keeperY: parseInt((document.getElementById('cfg-monsters-keeper-y') as HTMLInputElement).value, 10) || 5,
          keeperSprite: parseInt((document.getElementById('cfg-monsters-keeper-sprite') as HTMLInputElement).value, 10) || 1,
          keeperName: (document.getElementById('cfg-monsters-keeper-name') as HTMLInputElement).value.trim() || 'Monster Keeper'
        },
        nameTags: {
          enabled: (document.getElementById('cfg-nametags-enabled') as HTMLInputElement).checked,
          nameStyle: parseInt((document.getElementById('cfg-nametags-style') as HTMLInputElement).value, 10) || 3
        }
      }
    });
  });
}
