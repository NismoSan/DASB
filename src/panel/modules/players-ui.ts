// @ts-nocheck
import { escapeHtml, formatDateTime } from './text';

type PlayersUiDeps = {
  socket: any,
  navLinks: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createPlayersUi(deps: PlayersUiDeps) {
  var socket = deps.socket;
  var navLinks = deps.navLinks;
  var showToast = deps.showToast;

  var resetAppearancesBtn = document.getElementById('btn-reset-appearances');
  if (resetAppearancesBtn) {
    resetAppearancesBtn.addEventListener('click', function () {
      if (!confirm('Reset all player appearances?\n\nThis clears stored looks and sprite cache. New appearances will be collected automatically.')) return;
      socket.emit('players:resetAppearances');
    });
  }

  var wipeBtn = document.getElementById('btn-wipe-player-data');
  if (wipeBtn) {
    wipeBtn.addEventListener('click', function () {
      if (!confirm('Are you sure you want to wipe ALL player data?\n\nThis will delete all sightings, player profiles, legend marks, and chat logs.\n\nThis cannot be undone.')) return;
      if (!confirm('Really? This deletes everything. Last chance.')) return;
      socket.emit('players:wipeAll');
    });
  }

  var playersListView = document.getElementById('players-list-view');
  var playersDetailView = document.getElementById('players-detail-view');
  var playersSearch = document.getElementById('players-search');
  var playersClassFilter = document.getElementById('players-class-filter');
  var playersSort = document.getElementById('players-sort');
  var playersRefreshBtn = document.getElementById('players-refresh');
  var playersTableContainer = document.getElementById('players-table-container');
  var playersCountEl = document.getElementById('players-count');
  var playersBackBtn = document.getElementById('players-back-btn');

  var allPlayersData = [];

  function flattenSessions(players) {
    var rows = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var sessions = p.sessions || [];
      if (sessions.length === 0) {
        rows.push({
          name: p.name,
          className: p.className,
          title: p.title,
          isMaster: p.isMaster,
          appeared: p.firstSeen || null,
          disappeared: p.lastSeen || null,
          isOnline: false
        });
      } else {
        for (var j = 0; j < sessions.length; j++) {
          var s = sessions[j];
          rows.push({
            name: p.name,
            className: p.className,
            title: p.title,
            isMaster: p.isMaster,
            appeared: s.appeared,
            disappeared: s.disappeared,
            isOnline: !s.disappeared
          });
        }
      }
    }
    return rows;
  }

  var playersPage = 0;
  var PLAYERS_PER_PAGE = 100;

  function renderPlayersTable(players) {
    var search = playersSearch ? playersSearch.value.toLowerCase() : '';
    var classFilter = playersClassFilter ? playersClassFilter.value : '';
    var sortBy = playersSort ? playersSort.value : 'appeared';

    var filtered = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (classFilter && (p.className || '').indexOf(classFilter) === -1) continue;
      if (search) {
        var matchesSearch = p.name.toLowerCase().indexOf(search) !== -1 ||
               (p.className || '').toLowerCase().indexOf(search) !== -1 ||
               (p.title && p.title.toLowerCase().indexOf(search) !== -1);
        if (!matchesSearch) continue;
      }
      var sessions = p.sessions || [];
      var lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
      var isOnline = lastSession && !lastSession.disappeared;
      filtered.push({
        name: p.name,
        className: p.className,
        title: p.title,
        isMaster: p.isMaster,
        appeared: lastSession ? lastSession.appeared : (p.firstSeen || null),
        disappeared: lastSession ? lastSession.disappeared : (p.lastSeen || null),
        isOnline: isOnline,
        sessionCount: sessions.length,
        hp: p.hp || null,
        mp: p.mp || null
      });
    }

    filtered.sort(function (a, b) {
      if (sortBy === 'name') return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (sortBy === 'disappeared') {
        if (!a.disappeared && !b.disappeared) return new Date(b.appeared || 0).getTime() - new Date(a.appeared || 0).getTime();
        if (!a.disappeared) return -1;
        if (!b.disappeared) return 1;
        return new Date(b.disappeared).getTime() - new Date(a.disappeared).getTime();
      }
      return new Date(b.appeared || 0).getTime() - new Date(a.appeared || 0).getTime();
    });

    var totalPages = Math.ceil(filtered.length / PLAYERS_PER_PAGE) || 1;
    if (playersPage >= totalPages) playersPage = totalPages - 1;
    if (playersPage < 0) playersPage = 0;
    var start = playersPage * PLAYERS_PER_PAGE;
    var pageItems = filtered.slice(start, start + PLAYERS_PER_PAGE);

    if (playersCountEl) {
      playersCountEl.textContent = filtered.length + ' players' +
        (totalPages > 1 ? ' (page ' + (playersPage + 1) + '/' + totalPages + ')' : '');
    }

    if (pageItems.length === 0) {
      playersTableContainer.innerHTML = '<div class="rules-empty">No players found.</div>';
      return;
    }

    var html = '<table class="players-table"><thead><tr>' +
      '<th>Name</th><th>Class</th><th>Title</th><th>HP / MP</th><th>Last Seen</th><th>Status</th>' +
      '</tr></thead><tbody>';

    for (var j = 0; j < pageItems.length; j++) {
      var r = pageItems[j];
      var nameClass = 'player-name-cell' + (r.isMaster ? ' is-master' : '');
      var lastSeen = r.appeared ? formatDateTime(new Date(r.appeared)) : '--';
      var status = r.isOnline ? '<span style="color:#4caf50;font-weight:bold;">Online</span>' :
                   (r.disappeared ? formatDateTime(new Date(r.disappeared)) : '--');
      var hpmp = '';
      if (r.hp || r.mp) {
        hpmp = (r.hp ? '<span class="stat-hp">' + r.hp.toLocaleString() + '</span>' : '') +
               (r.hp && r.mp ? ' / ' : '') +
               (r.mp ? '<span class="stat-mp">' + r.mp.toLocaleString() + '</span>' : '');
      }

      html += '<tr data-player-name="' + escapeHtml(r.name) + '">' +
        '<td class="' + nameClass + '">' + escapeHtml(r.name) + '</td>' +
        '<td class="player-class-cell">' + escapeHtml(r.className || '--') + '</td>' +
        '<td class="player-title-cell">' + escapeHtml(r.title || '') + '</td>' +
        '<td class="player-seen-cell">' + hpmp + '</td>' +
        '<td class="player-seen-cell">' + lastSeen + '</td>' +
        '<td class="player-seen-cell">' + status + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';

    if (totalPages > 1) {
      html += '<div class="players-pagination">' +
        '<button class="btn btn-small players-page-prev"' + (playersPage === 0 ? ' disabled' : '') + '>&laquo; Prev</button>' +
        '<span class="players-page-info">Page ' + (playersPage + 1) + ' of ' + totalPages + '</span>' +
        '<button class="btn btn-small players-page-next"' + (playersPage >= totalPages - 1 ? ' disabled' : '') + '>Next &raquo;</button>' +
      '</div>';
    }

    playersTableContainer.innerHTML = html;

    playersTableContainer.onclick = function (e) {
      var row = e.target.closest('tr[data-player-name]');
      if (row) showPlayerDetail(row.getAttribute('data-player-name'));
      var prevBtn = e.target.closest('.players-page-prev');
      if (prevBtn && playersPage > 0) { playersPage--; renderPlayersTable(allPlayersData); }
      var nextBtn = e.target.closest('.players-page-next');
      if (nextBtn && playersPage < totalPages - 1) { playersPage++; renderPlayersTable(allPlayersData); }
    };
  }

  function showPlayerDetail(name) {
    playersListView.style.display = 'none';
    playersDetailView.style.display = '';
    socket.emit('players:getDetail', { name: name });
  }

  function showPlayersList() {
    playersDetailView.style.display = 'none';
    playersListView.style.display = '';
  }

  socket.on('players:list', function (players) {
    allPlayersData = players || [];
    renderPlayersTable(allPlayersData);
  });

  socket.on('players:detail', function (detail) {
    if (!detail) return;
    renderPlayerDetail(detail);
  });

  function renderPlayerDetail(d) {
    var headerEl = document.getElementById('player-detail-header');
    var nameClass = d.isMaster ? 'player-detail-name is-master' : 'player-detail-name';
    var firstSeen = d.firstSeen ? new Date(d.firstSeen).toLocaleString() : 'Unknown';
    var lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'Unknown';

    headerEl.innerHTML =
      '<div class="' + nameClass + '">' + escapeHtml(d.name) + '</div>' +
      '<div class="player-detail-meta">' +
        '<div class="player-detail-meta-item"><label>Class</label><span>' + escapeHtml(d.className || 'Unknown') + '</span></div>' +
        '<div class="player-detail-meta-item"><label>Title</label><span>' + escapeHtml(d.title || 'None') + '</span></div>' +
        '<div class="player-detail-meta-item"><label>First Seen</label><span>' + firstSeen + '</span></div>' +
        '<div class="player-detail-meta-item"><label>Last Seen</label><span>' + lastSeen + '</span></div>' +
        '<div class="player-detail-meta-item"><label>Total Sightings</label><span>' + (d.sightingCount || 0) + '</span></div>' +
        '<div class="player-detail-meta-item"><label>User List Appearances</label><span>' + (d.userListSightings ? d.userListSightings.length : 0) + '</span></div>' +
      '</div>';

    var activityEl = document.getElementById('player-activity-list');
    var events = [];

    if (d.sightings && d.sightings.length) {
      for (var i = 0; i < d.sightings.length; i++) {
        events.push({ time: d.sightings[i], type: 'sighting', label: 'Seen near bot' });
      }
    }
    if (d.userListSightings && d.userListSightings.length) {
      for (var j = 0; j < d.userListSightings.length; j++) {
        events.push({ time: d.userListSightings[j], type: 'userlist', label: 'On user list' });
      }
    }

    events.sort(function (a, b) { return new Date(b.time).getTime() - new Date(a.time).getTime(); });
    events = events.slice(0, 200);

    if (events.length === 0) {
      activityEl.innerHTML = '<div class="rules-empty">No activity recorded.</div>';
    } else {
      var html = '';
      for (var k = 0; k < events.length; k++) {
        var ev = events[k];
        html += '<div class="player-activity-item">' +
          '<span class="player-activity-time">' + new Date(ev.time).toLocaleString() + '</span>' +
          '<span class="player-activity-label ' + ev.type + '">' + ev.label + '</span>' +
          '</div>';
      }
      activityEl.innerHTML = html;
    }

    var chatLogsEl = document.getElementById('player-chat-logs');
    if (d.chatLogs && d.chatLogs.length > 0) {
      var logHtml = '';
      for (var l = 0; l < d.chatLogs.length; l++) {
        logHtml += '<div class="log-line">' + escapeHtml(d.chatLogs[l]) + '</div>';
      }
      chatLogsEl.innerHTML = logHtml;
      chatLogsEl.scrollTop = chatLogsEl.scrollHeight;
    } else {
      chatLogsEl.innerHTML = '<div class="rules-empty">No chat logs for this player.</div>';
    }

    var ulHistEl = document.getElementById('player-userlist-history');
    if (d.userListSightings && d.userListSightings.length > 0) {
      var ulHtml = '';
      var ulSightings = d.userListSightings.slice(-100).reverse();
      for (var m = 0; m < ulSightings.length; m++) {
        ulHtml += '<div class="player-activity-item">' +
          '<span class="player-activity-time">' + new Date(ulSightings[m]).toLocaleString() + '</span>' +
          '<span class="player-activity-label userlist">Appeared on user list</span>' +
          '</div>';
      }
      ulHistEl.innerHTML = ulHtml;
    } else {
      ulHistEl.innerHTML = '<div class="rules-empty">No user list history for this player.</div>';
    }

    var legendsEl = document.getElementById('player-legends-list');
    if (d.legends && d.legends.length > 0) {
      var legendHtml = '';
      if (d.lastLegendUpdate) {
        legendHtml += '<div class="legend-updated">Last updated: ' + new Date(d.lastLegendUpdate).toLocaleString() + '</div>';
      }
      if (d.groupName) {
        legendHtml += '<div class="legend-profile-info"><label>Group</label><span>' + escapeHtml(d.groupName) + '</span></div>';
      }
      legendHtml += '<div class="legend-marks-container">';
      for (var li = 0; li < d.legends.length; li++) {
        var leg = d.legends[li];
        var colorClass = leg.color > 0 ? ' legend-color-' + leg.color : '';
        legendHtml += '<div class="legend-mark-item">' +
          '<span class="legend-mark-icon" title="Icon ' + leg.icon + '"></span>' +
          '<span class="legend-mark-key">' + escapeHtml(leg.key) + '</span>' +
          '<span class="legend-mark-text' + colorClass + '">' + escapeHtml(leg.text) + '</span>' +
          '</div>';
      }
      legendHtml += '</div>';

      if (d.legendHistory && d.legendHistory.length > 0) {
        legendHtml += '<div class="legend-history-section">' +
          '<div class="legend-history-header">Legend History (' + d.legendHistory.length + ' snapshots)</div>';
        for (var lh = d.legendHistory.length - 1; lh >= 0; lh--) {
          var snap = d.legendHistory[lh];
          legendHtml += '<div class="legend-history-snapshot">' +
            '<div class="legend-history-time">' + new Date(snap.timestamp).toLocaleString() + ' (' + snap.legends.length + ' marks)</div>' +
            '<div class="legend-history-marks">';
          for (var lhi = 0; lhi < snap.legends.length; lhi++) {
            var sleg = snap.legends[lhi];
            legendHtml += '<div class="legend-mark-item small">' +
              '<span class="legend-mark-key">' + escapeHtml(sleg.key) + '</span>' +
              '<span class="legend-mark-text">' + escapeHtml(sleg.text) + '</span>' +
              '</div>';
          }
          legendHtml += '</div></div>';
        }
        legendHtml += '</div>';
      }

      legendsEl.innerHTML = legendHtml;
    } else {
      legendsEl.innerHTML = '<div class="rules-empty">No legend marks recorded. Legends are captured when bots see this player on their map.</div>';
    }
  }

  var playerTabs = document.querySelectorAll('.player-tab');
  var playerTabContents = document.querySelectorAll('.player-tab-content');
  for (var pt = 0; pt < playerTabs.length; pt++) {
    playerTabs[pt].addEventListener('click', function () {
      var tabName = this.getAttribute('data-player-tab');
      for (var i = 0; i < playerTabs.length; i++) playerTabs[i].classList.remove('active');
      for (var j = 0; j < playerTabContents.length; j++) playerTabContents[j].classList.remove('active');
      this.classList.add('active');
      var target = document.getElementById('player-tab-' + tabName);
      if (target) target.classList.add('active');
    });
  }

  if (playersBackBtn) {
    playersBackBtn.addEventListener('click', showPlayersList);
  }

  if (playersSearch) {
    playersSearch.addEventListener('input', function () { playersPage = 0; renderPlayersTable(allPlayersData); });
  }
  if (playersClassFilter) {
    playersClassFilter.addEventListener('change', function () { playersPage = 0; renderPlayersTable(allPlayersData); });
  }
  if (playersSort) {
    playersSort.addEventListener('change', function () { playersPage = 0; renderPlayersTable(allPlayersData); });
  }
  if (playersRefreshBtn) {
    playersRefreshBtn.addEventListener('click', function () {
      socket.emit('players:getAll');
    });
  }

  for (var nl = 0; nl < navLinks.length; nl++) {
    if (navLinks[nl].getAttribute('data-panel') === 'players') {
      navLinks[nl].addEventListener('click', function () {
        socket.emit('players:getAll');
      });
    }
  }

  var knowledgeEntries = [];

  function renderKnowledgeList(entries) {
    knowledgeEntries = entries || [];
    var container = document.getElementById('kb-list');
    var filterCat = document.getElementById('kb-filter-category').value;
    var countEl = document.getElementById('kb-count');

    var filtered = filterCat
      ? knowledgeEntries.filter(function (e) { return e.category === filterCat; })
      : knowledgeEntries;

    countEl.textContent = filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies');

    if (filtered.length === 0) {
      container.innerHTML = '<div class="rules-empty">No knowledge entries' + (filterCat ? ' in this category' : ' yet') + '.</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (entry) {
      html +=
        '<div class="rule-item kb-item" data-id="' + entry.id + '">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(entry.title) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small kb-btn-edit" data-id="' + entry.id + '">Edit</button>' +
              '<button class="btn btn-small btn-red kb-btn-delete" data-id="' + entry.id + '">Del</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">' + escapeHtml(entry.category) + '</span>' +
            '<span class="rule-pattern">' + escapeHtml(entry.content).substring(0, 120) + (entry.content.length > 120 ? '...' : '') + '</span>' +
          '</div>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  socket.on('knowledge:list', function (entries) {
    renderKnowledgeList(entries);
  });

  document.getElementById('kb-filter-category').addEventListener('change', function () {
    renderKnowledgeList(knowledgeEntries);
  });

  document.getElementById('kb-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var entry = {
      id: document.getElementById('kb-id').value ? parseInt(document.getElementById('kb-id').value) : null,
      category: document.getElementById('kb-category').value,
      title: document.getElementById('kb-title').value.trim(),
      content: document.getElementById('kb-content').value.trim()
    };
    if (!entry.title || !entry.content) {
      showToast('Title and content are required', true);
      return;
    }
    socket.emit('knowledge:save', entry);
    clearKbForm();
  });

  document.getElementById('kb-form-clear').addEventListener('click', clearKbForm);

  function clearKbForm() {
    document.getElementById('kb-id').value = '';
    document.getElementById('kb-category').value = 'items';
    document.getElementById('kb-title').value = '';
    document.getElementById('kb-content').value = '';
    document.getElementById('kb-form-title').textContent = 'Add Entry';
    document.getElementById('kb-form-fold').removeAttribute('open');
  }

  document.getElementById('kb-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-id]');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);

    if (btn.classList.contains('kb-btn-delete')) {
      if (confirm('Delete this knowledge entry?')) {
        socket.emit('knowledge:delete', { id: id });
      }
    } else if (btn.classList.contains('kb-btn-edit')) {
      var entry = null;
      for (var i = 0; i < knowledgeEntries.length; i++) {
        if (knowledgeEntries[i].id === id) { entry = knowledgeEntries[i]; break; }
      }
      if (!entry) return;
      document.getElementById('kb-id').value = entry.id;
      document.getElementById('kb-category').value = entry.category;
      document.getElementById('kb-title').value = entry.title;
      document.getElementById('kb-content').value = entry.content;
      document.getElementById('kb-form-title').textContent = 'Edit Entry';
      document.getElementById('kb-form-fold').setAttribute('open', '');
    }
  });

  var bulkText = document.getElementById('kb-bulk-text');
  var bulkPreview = document.getElementById('kb-bulk-preview');

  function parseBulkEntries() {
    var raw = bulkText.value.trim();
    if (!raw) return [];
    var blocks = raw.split(/\n\s*\n/);
    var entries = [];
    var category = document.getElementById('kb-bulk-category').value;
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      if (lines.length === 0 || !lines[0].trim()) continue;
      var title = lines[0].trim();
      var content = lines.length > 1 ? lines.slice(1).join('\n').trim() : title;
      entries.push({ category: category, title: title, content: content });
    }
    return entries;
  }

  bulkText.addEventListener('input', function () {
    var entries = parseBulkEntries();
    bulkPreview.textContent = entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + ' detected';
  });

  document.getElementById('kb-bulk-import-btn').addEventListener('click', function () {
    var entries = parseBulkEntries();
    if (entries.length === 0) {
      showToast('No entries to import', true);
      return;
    }
    if (!confirm('Import ' + entries.length + ' entries as "' + entries[0].category + '"?')) return;
    document.getElementById('kb-bulk-import-btn').disabled = true;
    bulkPreview.textContent = 'Importing...';
    socket.emit('knowledge:bulk-import', { entries: entries });
  });

  socket.on('knowledge:bulk-import-done', function (data) {
    document.getElementById('kb-bulk-import-btn').disabled = false;
    if (data.error) {
      showToast('Import error: ' + data.error, true);
      bulkPreview.textContent = 'Error after ' + data.count + ' entries';
    } else {
      showToast('Imported ' + data.count + ' entries');
      bulkText.value = '';
      bulkPreview.textContent = '';
    }
  });

  for (var kl = 0; kl < navLinks.length; kl++) {
    if (navLinks[kl].getAttribute('data-panel') === 'knowledge') {
      navLinks[kl].addEventListener('click', function () {
        socket.emit('knowledge:list');
      });
    }
  }
}
