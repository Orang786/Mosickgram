# 🎵 Mosickgram

Современный Discord-подобный мессенджер с новым минималистичным интерфейсом (2024-2025 дизайн).

## ✨ Особенности

- 💬 **Реал-тайм чатинг** через Socket.IO
- 🎨 **Новый Discord UI дизайн** - минималистичный и современный
- 🔐 **Безопасность** - хеширование паролей bcryptjs
- ⭐ **Система рейтинга** - заработок и трата звёзд
- 🚀 **Nitro подписка** - специальные привилегии
- 👨‍💼 **Admin панель** - управление пользователями и чатом
- 🗑️ **Модерация** - баны пользователей и удаление сообщений
- 📌 **Закрепленные сообщения** - сохранение важных постов
- 📸 **Отправка изображений** - делитесь фото в чате

## 🛠 Стек технологий

### Backend
- **Node.js + Express.js** - сервер приложения
- **Socket.IO v4.7.2** - реал-тайм коммуникация
- **MongoDB + Mongoose v8.0.0** - база данных
- **bcryptjs v2.4.3** - хеширование паролей

### Frontend
- **Vanilla JavaScript** - чистый JS без фреймворков
- **HTML5** - семантическая разметка
- **CSS3** - современный дизайн (Discord 2024)
- **Socket.IO Client** - реал-тайм обновления

## 🚀 Быстрый старт

### Локальная разработка

1. **Клонируйте репозиторий:**
```bash
git clone https://github.com/Orang786/Mosickgram.git
cd Mosickgram
```

2. **Установите зависимости:**
```bash
npm install
```

3. **Создайте `.env` файл:**
```env
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/?appName=Mosickgram
PORT=3000
NODE_ENV=development
```

4. **Запустите сервер:**
```bash
npm start
```

5. **Откройте в браузере:**
```
http://localhost:3000
```

## 📝 Команды

### Пользовательские команды
- `/ban @username` - заблокировать пользователя (только для админов)
- `/unban @username` - разблокировать пользователя (только для админов)

## 🌐 Развёртывание на Render

1. Создайте новый Web Service на [Render](https://render.com)
2. Подключите GitHub репозиторий
3. Установите переменные окружения:
   - `MONGO_URI` - строка подключения MongoDB
   - `NODE_ENV` - production

4. Сервис автоматически развернётся

## 📋 Структура проекта

```
Mosickgram/
├── server.js                 # Основной сервер Node.js
├── package.json             # Зависимости проекта
├── .env                     # Переменные окружения
├── public/
│   ├── index.html          # Главная страница
│   ├── client.js           # Клиентский JavaScript
│   └── style.css           # Стили (Discord дизайн)
└── database.json           # JSON хранилище (опционально)
```

## 🎨 Дизайн

Интерфейс полностью переработан под новый Discord дизайн (2024-2025):
- Минималистичный и чистый макет
- Мягкие скругленные углы (border-radius 4-12px)
- Просторный spacing и padding
- Современная типография
- Плавные анимации (0.15s transitions)
- Градиентные кнопки и аватары

## 🔒 Безопасность

✅ XSS защита - все пользовательские данные экранируются  
✅ Хеширование паролей bcryptjs  
✅ Проверка прав доступа на сервере  
✅ Валидация входных данных  
✅ CORS готов к продакшену  

## 📊 База данных

### Схемы MongoDB

**User:**
```javascript
{
  username: String (unique),
  password: String (hashed),
  stars: Number,
  isAdmin: Boolean,
  isNitro: Boolean,
  isBanned: Boolean,
  color: String (hex),
  avatarUrl: String,
  joinedAt: Date
}
```

**Message:**
```javascript
{
  channelId: String,
  username: String,
  type: String (message/system),
  text: String,
  image: String (base64),
  replyTo: ObjectId,
  isEdited: Boolean,
  userColor: String,
  isAdmin: Boolean,
  isNitro: Boolean,
  avatarUrl: String,
  timestamp: Date
}
```

**Channel:**
```javascript
{
  channelId: String (unique),
  name: String,
  desc: String,
  pinnedMessageId: ObjectId
}
```

## 🤝 Вклад

Приветствуются pull requests! Для больших изменений сначала откройте issue.

## 📄 Лицензия

MIT License - свободно используйте в своих проектах

## 📞 Контакты

- GitHub: [@Orang786](https://github.com/Orang786)
- MongoDB: OrangLaut@cluster

---

**Версия:** 1.0.0  
**Последнее обновление:** Июнь 2025  
**Статус:** ✅ В активной разработке
