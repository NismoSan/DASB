export function escapeHtml(text: any): string {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function getStatusLabel(status: any): string {
  switch (status) {
    case 'disconnected': return 'Offline';
    case 'connecting': return 'Connecting';
    case 'connected': return 'Connected';
    case 'logged_in': return 'Online';
    case 'reconnecting': return 'Reconnecting';
    case 'waiting_reconnect': return 'Waiting';
    default: return status;
  }
}

export function formatFiredAgo(ts: any): string {
  if (!ts) return '';
  var diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

export function formatCountdown(ms: any): string {
  if (ms <= 0) return 'now';
  var s = Math.floor(ms / 1000);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

export function formatDateTime(date: Date): string {
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var year = date.getFullYear();
  var hours = date.getHours();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  var minutes = date.getMinutes();
  var minStr = minutes < 10 ? '0' + minutes : '' + minutes;
  return month + '/' + day + '/' + year + ' ' + hours + ':' + minStr + ' ' + ampm;
}
