// @ts-nocheck
import { escapeHtml } from './text';
import { DYE_COLORS, SKIN_COLORS, getDyeInfo } from './appearance-reference';

type StatsUiDeps = {
  socket: any,
  navLinks: any,
};

export function createStatsUi(deps: StatsUiDeps) {
  var socket = deps.socket;
  var navLinks = deps.navLinks;
  var statsPlayers = [];

  function renderStatCards(players) {
    var grid = document.getElementById('stats-grid');
    var search = (document.getElementById('stats-search').value || '').toLowerCase();
    var classFilter = document.getElementById('stats-class-filter').value;
    var sortBy = document.getElementById('stats-sort').value;

    var filtered = players.filter(function (p) {
      if (!p.appearance) return false;
      if (search && p.name.toLowerCase().indexOf(search) === -1) return false;
      if (classFilter && (p.className || '').indexOf(classFilter) === -1) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'className') return (a.className || '').localeCompare(b.className || '');
      return new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime();
    });

    document.getElementById('stats-count').textContent = filtered.length + ' character' + (filtered.length !== 1 ? 's' : '');

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="rules-empty">No character appearance data matches your filters.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var p = filtered[i];
      var a = p.appearance;
      if (a.isMonster) continue;

      var genderIcon = a.gender === 'Male' ? '\u2642' : a.gender === 'Female' ? '\u2640' : '\u26A5';
      var isOnline = p.sessions && p.sessions.length > 0 && p.sessions[p.sessions.length - 1] && !p.sessions[p.sessions.length - 1].disappeared;
      var onlineDot = isOnline ? '<div class="stat-card-online" title="Online"></div>' : '';

      var spriteVer = p.lastAppearanceUpdate ? '?v=' + new Date(p.lastAppearanceUpdate).getTime() : '';
      var spriteImg = '<img class="stat-card-sprite" src="/api/sprite/' + encodeURIComponent(p.name) + '.png' + spriteVer + '" alt="" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="stat-card-sprite-fallback" style="display:none">' +
        '<span class="gender-icon">' + genderIcon + '</span></div>';

      var hpMpLine = '';
      if (p.hp || p.mp) {
        hpMpLine = '<div class="stat-card-hpmp">' +
          (p.hp ? '<span class="stat-hp">HP ' + p.hp.toLocaleString() + '</span>' : '') +
          (p.hp && p.mp ? ' / ' : '') +
          (p.mp ? '<span class="stat-mp">MP ' + p.mp.toLocaleString() + '</span>' : '') +
        '</div>';
      }

      html += '<div class="stat-card" data-stat-player="' + escapeHtml(p.name) + '">' +
        onlineDot +
        '<div class="stat-card-sprite-wrap">' + spriteImg + '</div>' +
        '<div class="stat-card-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="stat-card-class">' + escapeHtml(p.className || 'Unknown') + (p.title ? ' \u2014 ' + escapeHtml(p.title) : '') + '</div>' +
        hpMpLine +
      '</div>';
    }

    grid.innerHTML = html;
  }

  function showStatDetail(name) {
    var player = null;
    for (var i = 0; i < statsPlayers.length; i++) {
      if (statsPlayers[i].name === name) { player = statsPlayers[i]; break; }
    }
    if (!player || !player.appearance) return;

    var a = player.appearance;
    var overlay = document.getElementById('stats-detail-overlay');
    var content = document.getElementById('stats-detail-content');

    var genderIcon = a.gender === 'Male' ? '\u2642' : a.gender === 'Female' ? '\u2640' : '\u26A5';

    var bodyInfo = '';
    function bodyItem(label, value) {
      return '<div class="detail-body-item"><div class="detail-body-item-label">' + label + '</div><div class="detail-body-item-value">' + value + '</div></div>';
    }
    bodyInfo += bodyItem('Gender', a.gender || 'Unknown');
    bodyInfo += bodyItem('Skin', SKIN_COLORS[a.skinColor] || 'Default');
    bodyInfo += bodyItem('Hair', getDyeInfo(a.hairColor).name);
    bodyInfo += bodyItem('Head', '#' + (a.headSprite || 0));
    bodyInfo += bodyItem('Face', '#' + (a.faceShape || 0));
    bodyInfo += bodyItem('Body', '#' + (a.bodySprite || 0));

    var equipRows = '';
    function equipRow(slot, spriteId, colorId) {
      var colorInfo = getDyeInfo(colorId || 0);
      var hasColor = colorId && colorId > 0;
      var hasSprite = spriteId && spriteId > 0;
      var colorCell = hasColor ?
        '<td><div class="detail-equip-color-cell"><span class="equip-color-swatch" style="background:' + colorInfo.hex + '"></span> ' + colorInfo.name + '</div></td>' :
        '<td style="color:var(--text-muted)">-</td>';
      return '<tr>' +
        '<td class="detail-equip-slot">' + slot + '</td>' +
        '<td class="detail-equip-id">' + (hasSprite ? '#' + spriteId : '<span style="color:var(--text-muted)">None</span>') + '</td>' +
        colorCell +
      '</tr>';
    }

    equipRows += equipRow('Armor', a.armorSprite, 0);
    equipRows += equipRow('Arms', a.armsSprite, 0);
    equipRows += equipRow('Weapon', a.weaponSprite, 0);
    equipRows += equipRow('Shield', a.shieldSprite, 0);
    equipRows += equipRow('Boots', a.bootsSprite, a.bootsColor);
    equipRows += equipRow('Overcoat', a.overcoatSprite, a.overcoatColor);
    equipRows += equipRow('Pants', 0, a.pantsColor);
    equipRows += equipRow('Accessory 1', a.acc1Sprite, a.acc1Color);
    equipRows += equipRow('Accessory 2', a.acc2Sprite, a.acc2Color);
    equipRows += equipRow('Accessory 3', a.acc3Sprite, a.acc3Color);

    var lastSeen = player.lastSeen ? new Date(player.lastSeen).toLocaleString() : 'Unknown';
    var isOnline = player.sessions && player.sessions.length > 0 && player.sessions[player.sessions.length - 1] && !player.sessions[player.sessions.length - 1].disappeared;
    var statusText = isOnline ? '<span style="color:var(--green-400)">Online</span>' : 'Last seen: ' + lastSeen;

    content.innerHTML =
      '<div class="detail-header">' +
        '<div class="detail-avatar">' +
          '<img class="detail-sprite" src="/api/sprite/' + encodeURIComponent(player.name) + '.png' + (player.lastAppearanceUpdate ? '?v=' + new Date(player.lastAppearanceUpdate).getTime() : '') + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'">' +
          '<span class="gender-icon" style="display:none">' + genderIcon + '</span>' +
        '</div>' +
        '<div>' +
          '<div class="detail-name">' + escapeHtml(player.name) + '</div>' +
          '<div class="detail-class">' + escapeHtml(player.className || 'Unknown') + (player.title ? ' \u2014 ' + escapeHtml(player.title) : '') + '</div>' +
          (a.groupBox ? '<div class="detail-group">' + escapeHtml(a.groupBox) + '</div>' : '') +
          '<div class="detail-meta">' + statusText + '</div>' +
          (player.hp || player.mp ?
            '<div class="detail-hpmp">' +
              (player.hp ? '<span class="detail-hp">HP ' + player.hp.toLocaleString() + '</span>' : '') +
              (player.hp && player.mp ? ' &nbsp;/&nbsp; ' : '') +
              (player.mp ? '<span class="detail-mp">MP ' + player.mp.toLocaleString() + '</span>' : '') +
              (player.lastSenseUpdate ? '<span class="detail-sense-time"> (sensed ' + new Date(player.lastSenseUpdate).toLocaleString() + ')</span>' : '') +
            '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="detail-body-info">' + bodyInfo + '</div>' +
      '<table class="detail-equip-table">' +
        '<thead><tr><th>Slot</th><th>Sprite ID</th><th>Color</th></tr></thead>' +
        '<tbody>' + equipRows + '</tbody>' +
      '</table>';

    overlay.style.display = 'flex';
  }

  document.getElementById('stats-grid').addEventListener('click', function (e) {
    var card = e.target.closest('.stat-card');
    if (card) showStatDetail(card.dataset.statPlayer);
  });

  document.getElementById('stats-detail-close').addEventListener('click', function () {
    document.getElementById('stats-detail-overlay').style.display = 'none';
  });

  document.getElementById('stats-detail-overlay').addEventListener('click', function (e) {
    if (e.target === this) this.style.display = 'none';
  });

  document.getElementById('stats-search').addEventListener('input', function () {
    renderStatCards(statsPlayers);
  });
  document.getElementById('stats-class-filter').addEventListener('change', function () {
    renderStatCards(statsPlayers);
  });
  document.getElementById('stats-sort').addEventListener('change', function () {
    renderStatCards(statsPlayers);
  });

  socket.on('players:list', function (players) {
    statsPlayers = players;
    if (document.getElementById('panel-stats').classList.contains('active')) {
      renderStatCards(statsPlayers);
    }
  });

  socket.on('player:appearanceUpdate', function (data) {
    console.log('[AppearanceUpdate] Received update for', data.name);
    for (var i = 0; i < statsPlayers.length; i++) {
      if (statsPlayers[i].name === data.name) {
        statsPlayers[i].appearance = data.appearance;
        statsPlayers[i].lastAppearanceUpdate = data.lastAppearanceUpdate;
        break;
      }
    }
    var ver = '?v=' + new Date(data.lastAppearanceUpdate).getTime();
    var encodedName = encodeURIComponent(data.name);
    var newSrc = '/api/sprite/' + encodedName + '.png' + ver;
    var allImgs = document.querySelectorAll('img.stat-card-sprite, img.detail-sprite');
    for (var j = 0; j < allImgs.length; j++) {
      if (allImgs[j].src.indexOf('/api/sprite/' + encodedName + '.png') !== -1) {
        allImgs[j].src = newSrc;
      }
    }
    var overlay = document.getElementById('stats-detail-overlay');
    if (overlay && overlay.style.display === 'flex') {
      var detailName = overlay.querySelector('.detail-name');
      if (detailName && detailName.textContent === data.name) {
        showStatDetail(data.name);
      }
    }
  });

  socket.on('player:senseUpdate', function (data) {
    console.log('[Sense] ' + data.name + ' HP=' + data.hp + ' MP=' + data.mp);
    for (var i = 0; i < statsPlayers.length; i++) {
      if (statsPlayers[i].name === data.name) {
        statsPlayers[i].hp = data.hp;
        statsPlayers[i].mp = data.mp;
        statsPlayers[i].lastSenseUpdate = new Date(data.timestamp).toISOString();
        break;
      }
    }
    if (document.getElementById('panel-stats').classList.contains('active')) {
      renderStatCards(statsPlayers);
    }
    var overlay = document.getElementById('stats-detail-overlay');
    if (overlay && overlay.style.display === 'flex') {
      var detailName = overlay.querySelector('.detail-name');
      if (detailName && detailName.textContent === data.name) {
        showStatDetail(data.name);
      }
    }
  });

  for (var sl = 0; sl < navLinks.length; sl++) {
    if (navLinks[sl].getAttribute('data-panel') === 'stats') {
      navLinks[sl].addEventListener('click', function () {
        socket.emit('players:getAll');
        renderStatCards(statsPlayers);
      });
    }
  }
}
