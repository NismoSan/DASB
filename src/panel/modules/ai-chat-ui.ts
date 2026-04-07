// @ts-nocheck
import { escapeHtml } from './text';

type AiChatUiDeps = {
  socket: any,
};

export function createAiChatUi(deps: AiChatUiDeps) {
  var socket = deps.socket;

  function renderBlacklist(list) {
    var container = document.getElementById('ai-blacklist-list');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="rules-empty">No players blacklisted.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<div class="rule-item rule-enabled" style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.6rem;">' +
        '<span class="rule-name">' + escapeHtml(list[i]) + '</span>' +
        '<button class="btn btn-small" data-unblock="' + escapeHtml(list[i]) + '">Unblock</button>' +
      '</div>';
    }
    container.innerHTML = html;

    var btns = container.querySelectorAll('[data-unblock]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        socket.emit('aichat:removeBlacklist', this.getAttribute('data-unblock'));
      });
    }
  }

  socket.on('aichat:blacklist', function (list) {
    renderBlacklist(list);
  });

  socket.emit('aichat:getBlacklist');

  var addBtn = document.getElementById('ai-blacklist-add');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var input = document.getElementById('ai-blacklist-name');
      var name = input.value.trim();
      if (!name) return;
      socket.emit('aichat:addBlacklist', name);
      input.value = '';
    });
  }
}
