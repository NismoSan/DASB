// @ts-nocheck
import { escapeHtml } from './text';

type AttendanceUiDeps = {
  socket: any,
};

export function createAttendanceUi(deps: AttendanceUiDeps) {
  var socket = deps.socket;
  var lastAttendanceState = null;

  function attendanceFormatTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function attendanceRender(state) {
    var badge = document.getElementById('attendance-status-badge');
    var eventNameEl = document.getElementById('attendance-event-name');
    var startedAtEl = document.getElementById('attendance-started-at');
    var totalCountEl = document.getElementById('attendance-total-count');
    var startForm = document.getElementById('attendance-start-form');
    var activeActions = document.getElementById('attendance-active-actions');
    var stoppedActions = document.getElementById('attendance-stopped-actions');

    if (!badge) return;

    if (state.active) {
      badge.innerHTML = '<span class="attendance-badge attendance-badge-active">Tracking</span>';
      startForm.style.display = 'none';
      activeActions.style.display = '';
      stoppedActions.style.display = 'none';
    } else if (state.stoppedAt) {
      badge.innerHTML = '<span class="attendance-badge attendance-badge-stopped">Stopped</span>';
      startForm.style.display = 'none';
      activeActions.style.display = 'none';
      stoppedActions.style.display = '';
    } else {
      badge.innerHTML = '<span class="attendance-badge attendance-badge-inactive">Inactive</span>';
      startForm.style.display = '';
      activeActions.style.display = 'none';
      stoppedActions.style.display = 'none';
    }

    eventNameEl.textContent = state.eventName || '—';
    startedAtEl.textContent = state.startedAt ? new Date(state.startedAt).toLocaleString() : '—';
    totalCountEl.textContent = state.totalCount || 0;

    var tbody = document.getElementById('attendance-tbody');
    if (!state.attendees || state.attendees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="attendance-empty">No attendees yet.' + (state.active ? ' Players will appear as they enter the tracker bot\'s screen.' : ' Start tracking to begin.') + '</td></tr>';
      return;
    }

    var rows = '';
    for (var i = 0; i < state.attendees.length; i++) {
      var a = state.attendees[i];
      rows += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="attendance-player-name">' + escapeHtml(a.name) + '</td>' +
        '<td>' + attendanceFormatTime(a.firstSeen) + '</td>' +
        '<td>' + attendanceFormatTime(a.lastSeen) + '</td>' +
        '<td>' + a.sightings + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = rows;
  }

  function attendanceExport(state) {
    if (!state || !state.attendees || state.attendees.length === 0) return;
    var lines = ['Attendance Report: ' + (state.eventName || 'Event')];
    lines.push('Date: ' + new Date(state.startedAt).toLocaleString());
    lines.push('Total Attendees: ' + state.totalCount);
    lines.push('');
    for (var i = 0; i < state.attendees.length; i++) {
      lines.push((i + 1) + '. ' + state.attendees[i].name);
    }
    var text = lines.join('\n');
    navigator.clipboard.writeText(text).then(function () {
      var notif = document.createElement('div');
      notif.className = 'toast';
      notif.textContent = 'Attendance copied to clipboard!';
      document.body.appendChild(notif);
      setTimeout(function () { notif.remove(); }, 3000);
    });
  }

  socket.on('attendance:update', function (state) {
    lastAttendanceState = state;
    attendanceRender(state);
  });

  socket.on('attendance:newAttendee', function () {
    socket.emit('attendance:getState');
  });

  document.getElementById('attendance-start-btn').addEventListener('click', function () {
    var nameInput = document.getElementById('attendance-name-input');
    var eventName = nameInput.value.trim() || 'Event';
    socket.emit('attendance:start', { eventName: eventName });
  });

  document.getElementById('attendance-stop-btn').addEventListener('click', function () {
    socket.emit('attendance:stop');
  });

  document.getElementById('attendance-export-btn').addEventListener('click', function () {
    if (lastAttendanceState) attendanceExport(lastAttendanceState);
  });

  document.getElementById('attendance-export-btn-2').addEventListener('click', function () {
    if (lastAttendanceState) attendanceExport(lastAttendanceState);
  });

  document.getElementById('attendance-clear-btn').addEventListener('click', function () {
    if (confirm('Clear all attendance data?')) {
      socket.emit('attendance:clear');
    }
  });
}
