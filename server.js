require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1.5e7 }); // 15MB limit

app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI; 
if (!MONGO_URI) console.error("❌ MONGO_URI Error: Check Render Environment Variables");

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB Connected');
        initDB();
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- СХЕМЫ ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    stars: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    isNitro: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    color: String,
    customColor: { type: String, default: null },
    avatarUrl: String,
    joinedAt: { type: Date, default: Date.now },
    openDMs: [{ type: String }] 
});

const MessageSchema = new mongoose.Schema({
    channelId: { type: String, default: 'global' },
    username: String,
    type: String, 
    text: String,
    image: String,
    replyTo: Object,
    isEdited: { type: Boolean, default: false },
    isNitro: Boolean,
    isAdmin: Boolean,
    userColor: String,
    avatarUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const ChannelSchema = new mongoose.Schema({
    channelId: { type: String, unique: true },
    name: String,
    desc: String,
    pinnedMessageId: String
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Channel = mongoose.model('Channel', ChannelSchema);

async function initDB() {
    try {
        const globalChan = await Channel.findOne({ channelId: 'global' });
        if (!globalChan) {
            await new Channel({ channelId: 'global', name: 'Global Chat', desc: 'Главный сервер' }).save();
        }
    } catch (e) { console.error(e); }
}

let activeSockets = {}; 

function getOnlineCount() {
    const uniqueUsers = new Set(Object.values(activeSockets));
    return uniqueUsers.size;
}

io.on('connection', (socket) => {
    // Сразу шлем онлайн
    socket.emit('update-online', getOnlineCount());

    // === ФУНКЦИИ ВХОДА ===
    async function joinChannel(socket, channelId) {
        if (channelId.startsWith('dm_')) {
            const username = activeSockets[socket.id];
            if (!username || !channelId.includes(username)) {
                return socket.emit('message', { type: 'system', text: '⛔ Нет доступа' });
            }
        }

        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(channelId);
        
        const msgs = await Message.find({ channelId }).sort({ timestamp: 1 }).limit(100);
        socket.emit('load-messages', msgs.map(m => formatMsg(m)));
        socket.emit('set-active-channel', channelId);

        if (!channelId.startsWith('dm_')) {
            const channel = await Channel.findOne({ channelId });
            if(channel && channel.pinnedMessageId) {
                const pinnedMsg = await Message.findById(channel.pinnedMessageId);
                if(pinnedMsg) socket.emit('update-pinned', formatMsg(pinnedMsg));
            } else {
                socket.emit('update-pinned', null);
            }
        } else {
            socket.emit('update-pinned', null);
        }
    }

    async function loginUser(socket, user) {
        activeSockets[socket.id] = user.username;
        socket.emit('login-success', user);
        
        const channels = await Channel.find();
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc });
        socket.emit('update-channels', channelsData);
        socket.emit('update-dms', user.openDMs || []);

        await joinChannel(socket, 'global');
        io.emit('update-online', getOnlineCount());
    }

    // === СОБЫТИЯ ===

    socket.on('auth', async (data) => {
        const { username, password, type } = data;
        if (!username || !password) return socket.emit('auth-error', 'Заполните поля');

        try {
            if (type === 'register') {
                const exists = await User.findOne({ username });
                if (exists) return socket.emit('auth-error', 'Ник занят');
                if (username.length > 15) return socket.emit('auth-error', 'Длинный ник');

                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = new User({
                    username,
                    password: hashedPassword,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16),
                    openDMs: []
                });
                await newUser.save();
                loginUser(socket, newUser);

            } else {
                const user = await User.findOne({ username });
                if (!user) return socket.emit('auth-error', 'Пользователь не найден');
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) return socket.emit('auth-error', 'Неверный пароль');
                if (user.isBanned) return socket.emit('auth-error', '⛔ ВЫ ЗАБАНЕНЫ!');

                loginUser(socket, user);
            }
        } catch (e) { console.error(e); }
    });

    socket.on('join-channel', (id) => joinChannel(socket, id));

    socket.on('create-channel', async (name) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        const id = 'chan-' + Date.now();
        await new Channel({ channelId: id, name, desc: `Создал: ${username}` }).save();
        const channels = await Channel.find();
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc });
        io.emit('update-channels', channelsData);
    });

    socket.on('start-dm', async (targetUsername) => {
        const myName = activeSockets[socket.id];
        if (!myName || myName === targetUsername) return;
        
        const targetUser = await User.findOne({ username: targetUsername });
        if (!targetUser) return;

        await User.updateOne({ username: myName }, { $addToSet: { openDMs: targetUsername } });
        await User.updateOne({ username: targetUsername }, { $addToSet: { openDMs: myName } });

        const me = await User.findOne({ username: myName });
        socket.emit('update-dms', me.openDMs);

        for (let [sockId, name] of Object.entries(activeSockets)) {
            if (name === targetUsername) {
                const him = await User.findOne({ username: targetUsername });
                io.to(sockId).emit('update-dms', him.openDMs);
            }
        }
        const participants = [myName, targetUsername].sort();
        const dmId = `dm_${participants[0]}_${participants[1]}`;
        socket.emit('force-join-dm', { dmId, target: targetUsername });
    });

    socket.on('send-message', async (data) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        
        const user = await User.findOne({ username });
        if (!user || user.isBanned) return; // Безопасная проверка
        
        if (data.text && data.text.startsWith('/')) return;

        // Лимит размера
        if (data.image) {
            const sizeInBytes = Buffer.byteLength(data.image, 'utf8');
            const limit = user.isNitro ? 15 * 1024 * 1024 : 1.5 * 1024 * 1024;
            if (sizeInBytes > limit) {
                return socket.emit('message', { type: 'system', text: `⚠ Файл велик. Лимит: ${user.isNitro ? '10MB' : '1MB'}` });
            }
        }

        const newMsg = new Message({
            channelId: data.channelId || 'global',
            username: user.username,
            type: data.image ? 'image' : 'user',
            text: data.text || '',
            image: data.image || null,
            replyTo: data.replyTo,
            isNitro: user.isNitro,
            isAdmin: user.isAdmin,
            userColor: user.customColor || user.color,
            avatarUrl: user.avatarUrl
        });

        const savedMsg = await newMsg.save();
        io.to(savedMsg.channelId).emit('message', formatMsg(savedMsg));
    });

    socket.on('delete-message', async (id) => {
        const username = activeSockets[socket.id];
        if (!username) return;

        const msg = await Message.findById(id);
        if(!msg) return;

        const user = await User.findOne({ username });
        if (!user) return; // FIX CRASH

        if (msg.username === username || user.isAdmin) {
            await Message.findByIdAndDelete(id);
            io.emit('message-deleted', id);
            
            const chan = await Channel.findOne({ channelId: msg.channelId });
            if(chan && chan.pinnedMessageId === id) {
                chan.pinnedMessageId = null; await chan.save();
                io.to(msg.channelId).emit('update-pinned', null);
            }
        }
    });

    socket.on('edit-message', async (data) => {
        const username = activeSockets[socket.id];
        if (!username) return;

        const msg = await Message.findById(data.id);
        if(msg && msg.username === username) {
            msg.text = data.newText; 
            msg.isEdited = true;
            await msg.save();
            io.emit('message-updated', { id: msg._id, newText: msg.text });
        }
    });

    socket.on('pin-message', async (id) => {
        const username = activeSockets[socket.id];
        if (!username) return;

        const user = await User.findOne({username});
        if(!user || !user.isAdmin) return; // FIX CRASH

        const msg = await Message.findById(id);
        if(!msg || msg.channelId.startsWith('dm_')) return;
        
        await Channel.findOneAndUpdate({ channelId: msg.channelId }, { pinnedMessageId: id });
        io.to(msg.channelId).emit('update-pinned', formatMsg(msg));
    });
    
    socket.on('unpin-message', async () => {
         const username = activeSockets[socket.id];
         const user = await User.findOne({username});
         if(!user || !user.isAdmin) return;

         const room = Array.from(socket.rooms).find(r => r !== socket.id);
         if(room && !room.startsWith('dm_')) {
             await Channel.findOneAndUpdate({ channelId: room }, { pinnedMessageId: null });
             io.to(room).emit('update-pinned', null);
         }
    });

    socket.on('typing', () => {
        const u = activeSockets[socket.id];
        if(u) socket.broadcast.emit('display-typing', u);
    });

    socket.on('change-avatar', async (dataUri) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        await User.findOneAndUpdate({ username }, { avatarUrl: dataUri });
        const updated = await User.findOne({ username });
        socket.emit('update-user', updated);
    });
    
    // === ECONOMY ===
    socket.on('top-up-balance', async (amount) => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if (user) {
            user.stars += amount;
            await user.save();
            socket.emit('update-user', user);
            socket.emit('message', { type: 'system', text: `💳 +${amount} звезд` });
        }
    });

    socket.on('buy-nitro', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if (user && user.stars >= 500) {
            user.stars -= 500; user.isNitro = true;
            await user.save();
            socket.emit('update-user', user);
            io.emit('message', { type: 'system', text: `✨ ${user.username} купил NITRO!` });
        } else {
            socket.emit('payment-error', 'Недостаточно звезд!');
        }
    });

    socket.on('change-name-color', async (color) => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if (user && user.isNitro) {
            user.customColor = color; await user.save();
            socket.emit('update-user', user);
        }
    });

    // === ADMIN ===
    socket.on('admin-get-data', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if (!user || !user.isAdmin) return;

        const allUsers = await User.find({}, 'username stars isAdmin isBanned isNitro joinedAt');
        const stats = { totalUsers: allUsers.length, totalMessages: await Message.countDocuments(), onlineUsers: getOnlineCount() };
        const usersList = allUsers.map(u => ({
            _id: u._id, username: u.username, stars: u.stars, isAdmin: u.isAdmin, isBanned: u.isBanned, isNitro: u.isNitro,
            isOnline: Object.values(activeSockets).includes(u.username),
            joinedAt: u.joinedAt ? u.joinedAt.toLocaleDateString() : '?'
        }));
        socket.emit('admin-data-received', { users: usersList, stats });
    });

    socket.on('admin-user-action', async (data) => {
        const adminName = activeSockets[socket.id];
        const admin = await User.findOne({ username: adminName });
        if (!admin || !admin.isAdmin) return;

        const { userId, action } = data;
        const targetUser = await User.findById(userId);
        if (!targetUser) return;

        if (action === 'ban') {
            targetUser.isBanned = !targetUser.isBanned;
            if (targetUser.isBanned) {
                for (let [sockId, name] of Object.entries(activeSockets)) {
                    if (name === targetUser.username) {
                        io.to(sockId).emit('auth-error', 'ВЫ БЫЛИ ЗАБАНЕНЫ');
                        io.sockets.sockets.get(sockId)?.disconnect();
                    }
                }
            }
        } else if (action === 'promote') { targetUser.isAdmin = !targetUser.isAdmin; }
        else if (action === 'nitro') { targetUser.isNitro = !targetUser.isNitro; }
        
        await targetUser.save();
        socket.emit('admin-action-success'); 
    });

    socket.on('admin-clear-chat', async () => {
         const username = activeSockets[socket.id];
         const user = await User.findOne({ username });
         if(user && user.isAdmin) { await Message.deleteMany({}); io.emit('clear-chat'); }
    });
    
    socket.on('admin-give-stars', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if(user && user.isAdmin) { user.stars += 1000; await user.save(); socket.emit('update-user', user); }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
        io.emit('update-online', getOnlineCount());
    });
});

function formatMsg(m) {
    if(!m) return null;
    return {
        id: m._id.toString(), channelId: m.channelId, username: m.username, type: m.type, text: m.text, image: m.image, replyTo: m.replyTo,
        isEdited: m.isEdited, isNitro: m.isNitro, isAdmin: m.isAdmin, userColor: m.userColor, avatarUrl: m.avatarUrl,
        time: m.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
