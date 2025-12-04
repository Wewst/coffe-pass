const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
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
        cups_remaining INTEGER DEFAULT 0,
        month VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
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
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// ============ ПОМОЩНИКИ ============

// Генерация простого токена
function generateToken(userId, telegramId) {
  return Buffer.from(`${userId}:${telegramId}:${Date.now()}`).toString('base64');
}

// Парсинг токена
function parseToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    return {
      userId: parseInt(parts[0]),
      telegramId: parseInt(parts[1]),
      timestamp: parseInt(parts[2])
    };
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

// 3. АВТОРИЗАЦИЯ TELEGRAM - ФИКСИРОВАННАЯ!
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('🔑 Запрос авторизации от Telegram');
    
    const { initData } = req.body;
    
    if (!initData) {
      console.log('❌ Нет initData в запросе');
      return res.status(400).json({ 
        success: false,
        error: 'Нет данных от Telegram' 
      });
    }
    
    console.log('📱 Получены данные Telegram (первые 200 символов):', initData.substring(0, 200));
    
    // ПАРСИМ ДАННЫЕ TELEGRAM ПРАВИЛЬНО!
    let telegramUser = null;
    
    try {
      // Пробуем разные форматы данных от Telegram
      
      // 1. Если это query string от Telegram WebApp
      if (initData.includes('user=')) {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr) {
          telegramUser = JSON.parse(decodeURIComponent(userStr));
          console.log('✅ Пользователь из query string:', telegramUser);
        }
      }
      // 2. Если фронтенд уже распарсил и отправил объект
      else if (initData.id && initData.first_name) {
        telegramUser = initData;
        console.log('✅ Пользователь из объекта:', telegramUser);
      }
      // 3. Если это JSON строка
      else if (initData.startsWith('{')) {
        try {
          telegramUser = JSON.parse(initData);
          console.log('✅ Пользователь из JSON строки:', telegramUser);
        } catch (e) {
          console.log('❌ Не удалось распарсить как JSON:', e.message);
        }
      }
    } catch (parseError) {
      console.error('❌ Ошибка парсинга данных Telegram:', parseError);
    }
    
    // Если не получили данные пользователя
    if (!telegramUser || !telegramUser.id) {
      console.log('⚠️ Не удалось получить данные пользователя из Telegram');
      console.log('📋 Сырые данные:', initData);
      return res.status(400).json({
        success: false,
        error: 'Неверные данные Telegram'
      });
    }
    
    console.log(`👤 Telegram User ID: ${telegramUser.id}, Name: ${telegramUser.first_name}`);
    
    // НАХОДИМ ИЛИ СОЗДАЕМ ПОЛЬЗОВАТЕЛЯ В БАЗЕ
    let user;
    
    try {
      // Ищем пользователя по telegram_id
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramUser.id]
      );
      
      if (existingUser.rows.length > 0) {
        user = existingUser.rows[0];
        console.log(`👋 Найден существующий пользователь: ${user.first_name} (ID: ${user.id})`);
        
        // Обновляем информацию о пользователе
        await pool.query(
          `UPDATE users SET 
           username = $1, 
           first_name = $2, 
           last_name = $3,
           language_code = $4
           WHERE id = $5`,
          [
            telegramUser.username || user.username,
            telegramUser.first_name || user.first_name,
            telegramUser.last_name || user.last_name,
            telegramUser.language_code || user.language_code || 'ru',
            user.id
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
        console.log(`🎉 СОЗДАН НОВЫЙ ПОЛЬЗОВАТЕЛЬ: ${user.first_name} (Telegram ID: ${user.telegram_id})`);
        
        // Создаем начальную подписку
        const currentMonth = new Date().toISOString().slice(0, 7);
        await pool.query(
          `INSERT INTO subscriptions (user_id, cups_remaining, month) 
           VALUES ($1, $2, $3)`,
          [user.id, 0, currentMonth]
        );
      }
    } catch (dbError) {
      console.error('❌ Ошибка работы с базой данных:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Ошибка работы с базой данных'
      });
    }
    
    // Генерируем токен
    const token = generateToken(user.id, user.telegram_id);
    
    // Возвращаем успешный ответ
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
    
    console.log(`✅ Авторизация успешна для пользователя: ${user.first_name}`);
    
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error);
    res.status(500).json({ 
      success: false,
      error: 'Внутренняя ошибка сервера'
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
    const payload = parseToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    
    const userId = payload.userId;
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
    
    // Находим подписку текущего месяца
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
      subscriptionResult = await pool.query(
        `SELECT * FROM subscriptions 
         WHERE user_id = $1 AND month = $2`,
        [user.id, currentMonth]
      );
    }
    
    const subscription = subscriptionResult.rows[0];
    
    // Получаем партнеров
    const partnersResult = await pool.query('SELECT * FROM partners WHERE is_active = true');
    
    // Получаем историю кодов пользователя
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
    
    console.log(`📊 Состояние пользователя ${user.first_name}: ${subscription.cups_remaining} чашек`);
    
    res.json(state);
    
  } catch (error) {
    console.error('❌ Ошибка получения состояния:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
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
    const payload = parseToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    
    const userId = payload.userId;
    
    if (!cups || cups <= 0) {
      return res.status(400).json({ error: 'Неверное количество чашек' });
    }
    
    console.log(`💰 Покупка ${cups} чашек для пользователя ID: ${userId}`);
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const pricePerCup = 167;
    const totalPrice = Math.round(pricePerCup * cups);
    
    // Обновляем подписку
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining + $1, 
           updated_at = NOW()
       WHERE user_id = $2 AND month = $3`,
      [cups, userId, currentMonth]
    );
    
    // Получаем обновленное количество чашек
    const updatedSubscription = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    const newRemaining = updatedSubscription.rows[0].cups_remaining;
    
    // СОХРАНЯЕМ ПЛАТЕЖ В БАЗУ
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, amount, cups_added, status) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, totalPrice, cups, 'completed']
    );
    
    console.log(`✅ Покупка успешна. Осталось чашек: ${newRemaining}`);
    
    res.json({
      success: true,
      message: `Оплачено ${cups} чашек`,
      remaining: newRemaining,
      payment_id: paymentResult.rows[0].id
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
    const payload = parseToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    
    const userId = payload.userId;
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

    console.log(`✅ Код сохранен: ${code} для партнера ${partner_name}`);
    
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
    const payload = parseToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    
    const userId = payload.userId;
    
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
