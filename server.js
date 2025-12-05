const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS для фронтенда и Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Подключаемся к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('✅ Подключение к PostgreSQL...');

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function initDatabase() {
  try {
    console.log('🔄 Создаем таблицы...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        language_code VARCHAR(10),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        cups_total INTEGER DEFAULT 12,
        cups_remaining INTEGER DEFAULT 12,
        is_active BOOLEAN DEFAULT true,
        price_paid INTEGER DEFAULT 2000,
        month VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        amount INTEGER NOT NULL,
        cups_added INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        code VARCHAR(20) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT false,
        used_at TIMESTAMP,
        partner_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        address VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      INSERT INTO partners (name, description, address) VALUES
        ('Кофейня на Набережной', 'Уют у Камской набережной', 'ул. Набережная, 12'),
        ('Teatral Coffee', 'Рядом с театром', 'ул. Театральная, 5'),
        ('Горка Кофе', 'Терраса у памятника', 'пл. Ворота, 1'),
        ('Кофе и Пермь', 'Классика в центре', 'ул. Ленина, 44')
      ON CONFLICT (name) DO NOTHING;
    `);
    
    console.log('✅ Все таблицы созданы');
    
    // Проверяем партнеров
    const partnersResult = await pool.query('SELECT COUNT(*) as count FROM partners');
    console.log('📊 Партнеров в базе: ' + partnersResult.rows[0].count);
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// ============ ПОМОЩНИКИ ============

// Генерация JWT токена
function generateToken(userId, telegramId) {
  const payload = {
    user_id: userId,
    telegram_id: telegramId,
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 дней
  };
  
  const token = Buffer.from(JSON.stringify(payload)).toString('base64');
  return token;
}

// Проверка токена
function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const payload = JSON.parse(decoded);
    
    // Проверяем срок действия
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

// ============ API РОУТЫ ============

// 1. Health Check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Партнеры
app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. АВТОРИЗАЦИЯ TELEGRAM - ИСПРАВЛЕННАЯ!
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('🔑 Получен запрос на авторизацию');
    
    const { initData } = req.body;
    
    if (!initData) {
      return res.status(400).json({ error: 'Нет данных от Telegram' });
    }
    
    let telegramUser;
    
    try {
      // Telegram WebApp отправляет данные в формате query string
      // Например: user={"id":123,"first_name":"Ivan"...}&auth_date=...
      if (initData.includes('user=')) {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr && userStr !== '') {
          telegramUser = JSON.parse(decodeURIComponent(userStr));
          console.log('✅ Telegram данные получены (из query string):', {
            id: telegramUser.id,
            name: telegramUser.first_name,
            username: telegramUser.username
          });
        }
      } 
      // Или если фронтенд отправил уже распарсенный объект
      else if (typeof initData === 'object' && initData.id) {
        telegramUser = initData;
        console.log('✅ Telegram данные получены (из объекта):', telegramUser);
      }
      // Или если это JSON строка
      else if (initData.startsWith('{')) {
        try {
          telegramUser = JSON.parse(initData);
          console.log('✅ Telegram данные получены (из JSON строки):', telegramUser);
        } catch (e) {
          console.log('❌ Ошибка парсинга JSON:', e.message);
        }
      }
    } catch (parseError) {
      console.error('❌ Ошибка парсинга Telegram данных:', parseError);
    }
    
    // Если не получили данные пользователя
    if (!telegramUser || !telegramUser.id) {
      console.log('⚠️ Не удалось получить данные Telegram из initData');
      console.log('📋 Сырые данные (первые 200 символов):', initData.substring(0, 200));
      
      // Пробуем получить данные из Telegram WebApp напрямую (если это фронтенд отправил user объект)
      if (req.body.user && req.body.user.id) {
        telegramUser = req.body.user;
        console.log('✅ Используем данные из поля user:', telegramUser);
      } else {
        return res.status(400).json({ 
          success: false,
          error: 'Не удалось получить данные пользователя из Telegram'
        });
      }
    }
    
    // Проверяем обязательные поля
    if (!telegramUser.id || !telegramUser.first_name) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные данные пользователя (id, first_name)'
      });
    }
    
    console.log(`👤 Telegram User ID: ${telegramUser.id}, Name: ${telegramUser.first_name}, Username: ${telegramUser.username || 'нет'}`);
    
    // Находим или создаем пользователя в БД
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramUser.id]
    );
    
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      console.log(`👋 Найден существующий пользователь: ${user.first_name} (ID: ${user.id}, Telegram ID: ${user.telegram_id})`);
      
      // Обновляем информацию о пользователе (если изменилась)
      await pool.query(
        `UPDATE users 
         SET username = COALESCE($1, username), 
             first_name = COALESCE($2, first_name), 
             last_name = COALESCE($3, last_name),
             language_code = COALESCE($4, language_code)
         WHERE telegram_id = $5`,
        [
          telegramUser.username,
          telegramUser.first_name,
          telegramUser.last_name,
          telegramUser.language_code || 'ru',
          telegramUser.id
        ]
      );
      
    } else {
      // СОЗДАЕМ НОВОГО ПОЛЬЗОВАТЕЛЯ!
      const newUser = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, language_code) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          telegramUser.id,
          telegramUser.username || '',
          telegramUser.first_name,
          telegramUser.last_name || '',
          telegramUser.language_code || 'ru'
        ]
      );
      user = newUser.rows[0];
      console.log(`✅ СОЗДАН НОВЫЙ ПОЛЬЗОВАТЕЛЬ: ${user.first_name} (Telegram ID: ${user.telegram_id}, База ID: ${user.id})`);
      
      // Создаем начальную подписку
      const currentMonth = new Date().toISOString().slice(0, 7);
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) 
         VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
      console.log(`📅 Создана подписка на месяц ${currentMonth} для пользователя ${user.first_name}`);
    }
    
    // Генерируем токен
    const token = generateToken(user.id, user.telegram_id);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name
      }
    });
    
    console.log(`✅ Авторизация успешна для пользователя: ${user.first_name} (Token: ${token.substring(0, 30)}...)`);
    
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error);
    res.status(500).json({ 
      success: false,
      error: 'Внутренняя ошибка сервера при авторизации: ' + error.message
    });
  }
});

// 4. ПОЛУЧИТЬ СОСТОЯНИЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/state', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный или просроченный токен' });
    }
    
    const userId = payload.user_id;
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Получаем пользователя
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    // Находим подписку текущего месяца (или создаем пустую)
    let subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [user.id, currentMonth]
    );
    
    if (subscriptionResult.rows.length === 0) {
      // Создаем подписку для текущего месяца
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) 
         VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
      
      // Получаем созданную подписку
      subscriptionResult = await pool.query(
        `SELECT * FROM subscriptions 
         WHERE user_id = $1 AND month = $2`,
        [user.id, currentMonth]
      );
    }
    
    const subscription = subscriptionResult.rows[0];
    
    // Получаем партнеров
    const partnersResult = await pool.query('SELECT * FROM partners WHERE is_active = true');
    
    // Получаем историю кодов пользователя (последние 20)
    const codesResult = await pool.query(
      `SELECT * FROM codes 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [user.id]
    );
    
    // Получаем историю платежей
    const paymentsResult = await pool.query(
      `SELECT * FROM payments 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [user.id]
    );
    
    const state = {
      purchased: subscription.cups_remaining > 0,
      remaining: subscription.cups_remaining,
      month: subscription.month,
      subscription: subscription,
      partners: partnersResult.rows,
      codes: codesResult.rows,
      payments: paymentsResult.rows,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name
      }
    };
    
    console.log(`📊 Состояние пользователя ${user.first_name} (ID: ${user.telegram_id}): ${subscription.cups_remaining} чашек, purchased: ${state.purchased}`);
    
    res.json(state);
    
  } catch (error) {
    console.error('❌ Ошибка получения состояния:', error);
    res.status(500).json({ error: 'Ошибка получения данных пользователя' });
  }
});

// 5. ПОКУПКА
app.post('/api/purchase', async (req, res) => {
  try {
    const { cups } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный или просроченный токен' });
    }
    
    const userId = payload.user_id;
    
    if (!cups || cups <= 0) {
      return res.status(400).json({ error: 'Неверное количество чашек' });
    }
    
    console.log(`💰 Покупка ${cups} чашек для пользователя ID: ${userId}`);
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const pricePerCup = 167;
    const totalPrice = Math.round(pricePerCup * cups);
    
    // Получаем текущую подписку
    const subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    let subscriptionId;
    let newRemaining;
    
    if (subscriptionResult.rows.length > 0) {
      const subscription = subscriptionResult.rows[0];
      subscriptionId = subscription.id;
      newRemaining = subscription.cups_remaining + cups;
      
      // Обновляем существующую подписку
      await pool.query(
        `UPDATE subscriptions 
         SET cups_remaining = $1, 
             updated_at = NOW(),
             is_active = true
         WHERE id = $2`,
        [newRemaining, subscriptionId]
      );
    } else {
      // Создаем новую подписку
      const newSubscription = await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month, is_active) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, cups, currentMonth, true]
      );
      subscriptionId = newSubscription.rows[0].id;
      newRemaining = cups;
    }
    
    // СОХРАНЯЕМ ПЛАТЕЖ В БАЗУ
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, subscription_id, amount, cups_added, status) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, subscriptionId, totalPrice, cups, 'completed']
    );
    
    console.log(`✅ Покупка успешна. Платеж ID: ${paymentResult.rows[0].id}, Чашек осталось: ${newRemaining}`);
    
    res.json({
      success: true,
      message: `Оплачено ${cups} чашек`,
      remaining: newRemaining,
      payment_id: paymentResult.rows[0].id,
      subscription: {
        id: subscriptionId,
        cups_remaining: newRemaining,
        month: currentMonth
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка покупки:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Генерация кода
app.post('/api/codes/generate', async (req, res) => {
  try {
    const { partner_name } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный или просроченный токен' });
    }
    
    const userId = payload.user_id;
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Проверяем, есть ли у пользователя чашки
    const subscriptionResult = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    if (subscriptionResult.rows.length === 0 || subscriptionResult.rows[0].cups_remaining <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Недостаточно чашек для генерации кода' 
      });
    }
    
    // Генерируем уникальный код
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    let isUnique = false;
    
    while (!isUnique) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const check = await pool.query('SELECT id FROM codes WHERE code = $1', [code]);
      isUnique = check.rows.length === 0;
    }
    
    // СОХРАНЯЕМ КОД В БАЗУ
    const codeResult = await pool.query(
      `INSERT INTO codes (user_id, code, partner_name) 
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, code, partner_name]
    );

    console.log(`✅ Код сохранен: ${code} для партнера ${partner_name}, пользователь ID: ${userId}`);
    
    // Уменьшаем счетчик чашек
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining - 1,
           updated_at = NOW()
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    // Получаем обновленное количество чашек
    const updatedSubscription = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    res.json({
      success: true,
      code: code,
      remaining: updatedSubscription.rows[0].cups_remaining
    });
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. История пользователя
app.get('/api/history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный или просроченный токен' });
    }
    
    const userId = payload.user_id;
    
    // Получаем коды
    const codesResult = await pool.query(
      `SELECT * FROM codes 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    // Получаем платежи
    const paymentsResult = await pool.query(
      `SELECT * FROM payments 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    res.json({
      codes: codesResult.rows,
      payments: paymentsResult.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения истории:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ЗАПУСК СЕРВЕРА ============
async function startServer() {
  try {
    await initDatabase();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 Сервер запущен на порту ' + PORT);
      console.log('🌐 Health: http://0.0.0.0:' + PORT + '/health');
      console.log('📊 API готов к работе!');
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Получен SIGTERM');
      server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

startServer();
