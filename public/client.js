document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // STATE
    let currentUser = null;
    let currentChannelId = 'global';
    let isRegisterMode = false;
    let contextMenu = null;
    let replyToMessage = null;
    let editingMessageId = null;
    let typingTimeout = null;
    let allUsersCache = []; // Кэш для поиска в админке

    const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2346/2346-preview.mp3');
    notificationSound.volume = 0.5;

    // DOM ELEMENTS
    const els = {
        appContainer: document.getElementById('app-container'),
        login: document.getElementById('login-screen'),
        userInput: document.getElementById('username-input'),
        passInput: document.getElementById('password-input'),
        error: document.getElementById('error-msg'),
        authTitle: document.getElementById('auth-title'),
        submitBtn: document.getElementById('submit-btn'),
        toggleText: document.getElementById('toggle-text'),
        
        myUser: document.getElementById('my-username'),
        myBal: document.getElementById('my-balance'),
        myAv: document.getElementById('my-avatar'),
        nitroColor: document.getElementById('nitro-color-picker'),
        adminBtn: document.getElementById('admin-btn'),
        
        chatTitle: document.getElementById('chat-title'),
        online: document.getElementById('online-counter'),
        chanList: document.getElementById('channels-list'),
        dmsList: document.getElementById('dms-list'),
        msgs: document.getElementById('messages-container'),
        
        input: document.getElementById('message-input'),
        fileInput: document.getElementById('file-input'),
        avatarInput: document.getElementById('avatar-input'),
        typing: document.getElementById('typing-indicator'),
        
        replyBar: document.getElementById('reply-bar'),
        replyInfo: document.getElementById('reply-info'),
        pinnedBar: document.getElementById('pinned-bar'),
        pinnedText: document.getElementById('pinned-text'),
        
        sidebar: document.querySelector('.sidebar'),
        welcome: document.getElementById('welcome-screen'),
        emojiPicker: document.getElementById('emoji-picker'),
        
        // ADMIN ELEMENTS
        adminPanel: document.getElementById('admin-panel'),
        usersList: document.getElementById('admin-users-list'),
        adminSearch: document.getElementById('admin-search'),
        
        payModal: document.getElementById('payment-modal'),
        nitroModal: document.getElementById('nitro-modal')
    };

    // --- AUTH ---
    function toggleAuthMode() {
        isRegisterMode = !isRegisterMode;
        els.error.innerText = '';
        els.authTitle.innerText = isRegisterMode ? "Регистрация" : "Вход";
        els.submitBtn.innerText = isRegisterMode ? "Создать" : "Войти";
        els.toggleText.innerText = isRegisterMode ? "Есть аккаунт?" : "Нет аккаунта?";
    }

    function submitAuth() {
        const u = els.userInput.value.trim();
        const p = els.passInput.value.trim();
        if(!u || !p) return els.error.innerText = "Заполните поля";
        socket.emit('auth', { username: u, password: p, type: isRegisterMode ? 'register' : 'login' });
    }

    socket.on('auth-error', msg => els.error.innerText = msg);
    socket.on('login-success', user => {
        currentUser = user;
        els.login.classList.add('hidden');
        updateUI(user);
        if(user.isAdmin) els.adminBtn.classList.remove('hidden');
        if(window.innerWidth > 768) els.welcome.classList.remove('hidden');
    });

    function updateUI(user) {
        currentUser = user;
        els.myUser.innerText = user.username + (user.isAdmin ? ' (A)' : '');
        els.myBal.innerText = `★ ${user.stars}`;
        
        if (user.customColor) els.myUser.style.color = user.customColor;
        else if (user.isNitro) els.myUser.style.color = '#a29bfe';
        else els.myUser.style.color = '#fff';

        if(user.avatarUrl) {
            els.myAv.innerHTML = `<img src="${user.avatarUrl}">`;
            els.myAv.style.background = 'transparent';
        } else {
            els.myAv.innerText = user.username[0].toUpperCase();
            els.myAv.style.background = user.color || '#555';
        }
        
        if(user.isNitro) {
            els.nitroColor.classList.remove('hidden');
            els.nitroColor.value = user.customColor || '#ffffff';
        }
    }

    socket.on('update-user', u => { currentUser = u; updateUI(u); });
    socket.on('update-online', c => { if(els.online) els.online.innerText = `(${c} online)`; });

    // --- ADMIN PANEL LOGIC (FIXED) ---
    function toggleAdmin() {
        if (!currentUser || !currentUser.isAdmin) return alert("Доступ запрещен! (Нужно isAdmin: true в базе)");
        els.adminPanel.classList.toggle('hidden');
        if (!els.adminPanel.classList.contains('hidden')) {
            refreshAdminData();
        }
    }
    
    function refreshAdminData() {
        console.log("Запрос данных админки...");
        socket.emit('admin-get-data');
    }

    socket.on('admin-data-received', (data) => {
        console.log("Данные админки получены:", data);
        const { users, stats } = data;
        allUsersCache = users; // Сохраняем для поиска

        // Статистика
        document.getElementById('stat-total-users').innerText = stats.totalUsers;
        document.getElementById('stat-msgs').innerText = stats.totalMessages;
        document.getElementById('stat-online').innerText = stats.onlineUsers;

        renderAdminUsers(users);
    });

    function renderAdminUsers(users) {
        els.usersList.innerHTML = '';
        if (users.length === 0) {
            els.usersList.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Нет пользователей</td></tr>';
            return;
        }

        users.forEach(u => {
            const tr = document.createElement('tr');
            
            let roles = '';
            if (u.isAdmin) roles += '<span class="badge admin">ADM</span>';
            if (u.isNitro) roles += '<span class="badge nitro">NITRO</span>';
            if (u.isBanned) roles += '<span class="badge banned">BAN</span>';
            if (roles === '') roles = '<span style="color:#555">-</span>';

            const status = u.isOnline 
                ? '<span style="color:#00b894">● On</span>' 
                : '<span style="color:#636e72">○ Off</span>';

            tr.innerHTML = `
                <td><b>${escapeHtml(u.username)}</b></td>
                <td>${status}</td>
                <td>${roles}</td>
                <td>
                    <button class="act-btn btn-ban" onclick="adminAction('${u._id}', 'ban')">
                        ${u.isBanned ? 'Разбан' : 'Бан'}
                    </button>
                    <button class="act-btn btn-promote" onclick="adminAction('${u._id}', 'promote')">
                        ${u.isAdmin ? 'Снять' : 'Дать'} ADM
                    </button>
                    <button class="act-btn" style="background:#ffeaa7" onclick="adminAction('${u._id}', 'nitro')">
                        ★
                    </button>
                </td>
            `;
            els.usersList.appendChild(tr);
        });
    }

    // Поиск
    window.filterUsers = function() {
        const query = els.adminSearch.value.toLowerCase();
        const filtered = allUsersCache.filter(u => u.username.toLowerCase().includes(query));
        renderAdminUsers(filtered);
    };

    window.adminAction = function(userId, action) {
        if (!confirm(`Выполнить: ${action}?`)) return;
        socket.emit('admin-user-action', { userId, action });
    };
    
    socket.on('admin-action-success', () => {
        refreshAdminData();
    });

    window.switchAdminTab = function(tabName) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
        document.querySelectorAll('.admin-menu-item').forEach(i => i.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        event.target.classList.add('active');
    };

    // --- OTHER LOGIC (SIDEBAR, CHAT, ETC) ---
    function openMobileChat() { if (window.innerWidth <= 768) els.appContainer.classList.add('show-chat'); }
    function goBackToMenu() { els.appContainer.classList.remove('show-chat'); }
    window.goBackToMenu = goBackToMenu;

    // ... (Остальной код: Payment, Channels, Messages) ...
    // Вставляю сокращенные версии для экономии места, так как они не менялись
    
    // --- PAYMENT ---
    window.topUp = (amt) => { socket.emit('top-up-balance', amt); els.payModal.classList.add('hidden'); alert('Успешно'); };
    window.buyNitroAction = () => { socket.emit('buy-nitro'); els.nitroModal.classList.add('hidden'); };
    window.openPaymentModal = () => els.payModal.classList.remove('hidden');
    window.openNitroModal = () => els.nitroModal.classList.remove('hidden');
    window.closeModals = () => { els.payModal.classList.add('hidden'); els.nitroModal.classList.add('hidden'); };

    // --- CHANNELS ---
    window.createChannelPrompt = () => { const n = prompt("Название:"); if(n) socket.emit('create-channel', n); };
    socket.on('update-channels', chans => {
        els.chanList.innerHTML = '';
        Object.keys(chans).forEach(id => {
            const div = document.createElement('div');
            div.className = `chat-item ${id === currentChannelId ? 'active' : ''}`;
            div.id = `chan-${id}`;
            div.onclick = () => switchChannel(id, chans[id].name);
            div.innerHTML = `<div class="avatar" style="font-size:0.8rem; background:#333">${chans[id].name[0]}</div><div class="chat-info"><h4>${chans[id].name}</h4></div>`;
            els.chanList.appendChild(div);
        });
    });
    socket.on('update-dms', dms => {
        els.dmsList.innerHTML = '';
        dms.forEach(u => {
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.onclick = () => startDM(u);
            div.innerHTML = `<div class="avatar" style="font-size:0.8rem; background:var(--accent-color)">${u[0]}</div><div class="chat-info"><h4>${u}</h4><p>ЛС</p></div>`;
            els.dmsList.appendChild(div);
        });
    });

    function startDM(u) { socket.emit('start-dm', u); switchSidebarView('dms'); openMobileChat(); }
    socket.on('force-join-dm', d => { switchSidebarView('dms'); switchChannel(d.dmId, d.target); });

    function switchChannel(id, name) {
        if(id === currentChannelId) { openMobileChat(); return; }
        currentChannelId = id; els.chatTitle.innerText = name || 'Чат'; els.msgs.innerHTML = '';
        els.welcome.classList.add('hidden');
        document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
        const act = document.getElementById(`chan-${id}`); if(act) act.classList.add('active');
        socket.emit('join-channel', id);
        openMobileChat();
    }
    socket.on('set-active-channel', id => currentChannelId = id);
    window.switchSidebarView = (view) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-btn-${view}`).classList.add('active');
        document.getElementById('channels-view').classList.add('hidden');
        document.getElementById('dms-view').classList.add('hidden');
        document.getElementById(`${view}-view`).classList.remove('hidden');
    };

    // --- MESSAGES ---
    function sendMessage() {
        const text = els.input.value; if(!text.trim()) return;
        if(editingMessageId) { socket.emit('edit-message', {id:editingMessageId, newText:text}); cancelReply(); }
        else { socket.emit('send-message', {text, replyTo:replyToMessage, channelId:currentChannelId}); cancelReply(); }
        els.input.value = '';
    }
    els.input.addEventListener('keypress', e => { if(e.key==='Enter') sendMessage(); });
    socket.on('message', msg => renderMessage(msg));
    socket.on('load-messages', msgs => { els.msgs.innerHTML=''; msgs.forEach(m=>renderMessage(m, false)); scrollToBottom(); });
    socket.on('clear-chat', () => els.msgs.innerHTML='');
    
    function renderMessage(msg, playSound=true) {
        if(document.getElementById(`msg-${msg.id}`)) return;
        const div = document.createElement('div'); div.id = `msg-${msg.id}`;
        if(msg.type === 'system') { div.className='message system-msg'; div.innerText=msg.text; }
        else {
            const isMe = currentUser && msg.username === currentUser.username;
            div.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
            div.oncontextmenu = (e) => showCtx(e, msg, isMe, currentUser.isAdmin);
            let content = msg.image ? `<img src="${msg.image}" class="chat-image" onclick="window.open(this.src)">` : `<div class="text">${escapeHtml(msg.text)}</div>`;
            if(msg.isEdited) content += `<span class="edited-mark">(изм.)</span>`;
            let reply = msg.replyTo ? `<div class="reply-quote">${msg.replyTo.username}: ${msg.replyTo.text}</div>` : '';
            let badges = msg.isAdmin ? '<span style="color:#ff7675">[A]</span>' : '';
            div.innerHTML = `<div class="meta"><span style="color:${msg.userColor||'#fff'}">${msg.username}</span>${badges}</div>${reply}${content}`;
            if(!isMe && playSound) notificationSound.play().catch(()=>{});
        }
        els.msgs.appendChild(div); if(playSound) scrollToBottom();
    }
    function scrollToBottom() { els.msgs.scrollTop = els.msgs.scrollHeight; }
    function escapeHtml(text) { return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ''; }
    
    // Updates
    socket.on('message-updated', d => { const el=document.getElementById(`msg-${d.id}`); if(el) el.querySelector('.text').innerText=d.newText; });
    socket.on('message-deleted', id => { const el=document.getElementById(`msg-${id}`); if(el) el.remove(); });
    socket.on('update-pinned', msg => { if(msg){ els.pinnedBar.classList.remove('hidden'); els.pinnedText.innerText=msg.text; } else els.pinnedBar.classList.add('hidden'); });

    // Utils
    document.onclick = (e) => { if(contextMenu && !e.target.closest('.context-menu')) contextMenu.remove(); };
    function showCtx(e, msg, isMe, isAdmin) {
        e.preventDefault(); if(contextMenu) contextMenu.remove();
        contextMenu = document.createElement('div'); contextMenu.className='context-menu';
        contextMenu.style.top=e.clientY+'px'; contextMenu.style.left=e.clientX+'px';
        if(msg.username!==currentUser.username) addCtxItem('ЛС', ()=>startDM(msg.username));
        addCtxItem('Ответ', ()=>startReply(msg));
        if(isMe) addCtxItem('Изм.', ()=>startEdit(msg));
        if(isMe||isAdmin) addCtxItem('Удалить', ()=>socket.emit('delete-message', msg.id));
        if(isAdmin) addCtxItem('Пин', ()=>socket.emit('pin-message', msg.id));
        document.body.appendChild(contextMenu);
    }
    function addCtxItem(t, cb) { const i=document.createElement('div'); i.className='context-menu-item'; i.innerText=t; i.onclick=cb; contextMenu.appendChild(i); }
    function startReply(m) { replyToMessage={username:m.username, text:m.text}; els.replyBar.classList.remove('hidden'); els.replyInfo.innerText=`To: ${m.username}`; }
    function startEdit(m) { editingMessageId=m.id; els.replyBar.classList.remove('hidden'); els.replyInfo.innerText="Edit"; els.input.value=m.text; }
    function cancelReply() { replyToMessage=null; editingMessageId=null; els.replyBar.classList.add('hidden'); els.input.value=''; }
    window.unpinMessage = () => { if(currentUser.isAdmin) socket.emit('unpin-message'); };
    window.cancelReply = cancelReply;
    window.toggleAdmin = toggleAdmin;
    window.refreshAdminData = refreshAdminData;
    window.adminGetStars = () => socket.emit('admin-give-stars');
    window.adminClearChat = () => { if(confirm('Очистить?')) socket.emit('admin-clear-chat'); };
    window.toggleEmoji = () => { if(els.emojiPicker) els.emojiPicker.classList.toggle('hidden'); };
    
    // Init Emoji
    if(els.emojiPicker) els.emojiPicker.addEventListener('emoji-click', e => els.input.value+=e.detail.unicode);
    
    // File
    els.fileInput.onchange = function() {
        const f=this.files[0]; if(!f)return;
        const r=new FileReader(); r.onload=e=>socket.emit('send-message',{text:'',image:e.target.result,channelId:currentChannelId}); r.readAsDataURL(f); this.value='';
    };
    els.myAv.onclick = () => els.avatarInput.click();
    els.avatarInput.onchange = function() {
        const f=this.files[0]; if(!f)return;
        const r=new FileReader(); r.onload=e=>socket.emit('change-avatar', e.target.result); r.readAsDataURL(f); this.value='';
    };
});
