const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');

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

// ============ СОЗДАНИЕ ТАБЛИЦ (ВАШИ ИСХОДНЫЕ + ДОПОЛНЕНИЯ) ============
async function initDatabase() {
  try {
    console.log('🔄 Создаем таблицы...');
    
    // 1. ВАША ИСХОДНАЯ ТАБЛИЦА users
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
    
    // 2. ВАША ИСХОДНАЯ ТАБЛИЦА subscriptions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        cups_total INTEGER DEFAULT 12,
        cups_remaining INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        price_paid INTEGER DEFAULT 2000,
        month VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // 3. ТАБЛИЦА payments (ВАША ИСХОДНАЯ + ДОПОЛНЕНИЯ ДЛЯ TBANK)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        amount INTEGER NOT NULL,
        cups_added INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending', -- изменено с 'completed' на 'pending'
        payment_method VARCHAR(20),
        transaction_id VARCHAR(100),
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // 4. ВАША ИСХОДНАЯ ТАБЛИЦА codes
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
    
    // 5. ВАША ИСХОДНАЯ ТАБЛИЦА partners
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        address VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- ВАШИ ИСХОДНЫЕ ДАННЫЕ О ПАРТНЕРАХ
      INSERT INTO partners (name, description, address) VALUES
        ('Кофейня на Набережной', 'Уют у Камской набережной', 'ул. Набережная, 12'),
        ('Teatral Coffee', 'Рядом с театром', 'ул. Театральная, 5'),
        ('Горка Кофе', 'Терраса у памятника', 'пл. Ворота, 1'),
        ('Кофе и Пермь', 'Классика в центре', 'ул. Ленина, 44')
      ON CONFLICT (name) DO NOTHING;
    `);
    
    console.log('✅ Все таблицы созданы (ваши исходные + платежи)');
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// ============ ПОМОЩНИКИ ============

// Парсим initData от Telegram
function parseTelegramInitData(initData) {
  try {
    console.log('📋 Парсим данные Telegram:', initData.substring(0, 100) + '...');
    
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) {
      throw new Error('No user data in initData');
    }
    
    const user = JSON.parse(decodeURIComponent(userStr));
    console.log('👤 Парсинг успешен:', user.first_name, user.id);
    
    return user;
    
  } catch (error) {
    console.error('❌ Ошибка парсинга Telegram данных:', error);
    throw error;
  }
}

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

// 3. АВТОРИЗАЦИЯ TELEGRAM
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('🔑 Получен запрос на авторизацию');
    
    const { initData } = req.body;
    
    if (!initData) {
      return res.status(400).json({ error: 'Нет данных от Telegram' });
    }
    
    let telegramUser;
    
    try {
      telegramUser = parseTelegramInitData(initData);
      console.log('✅ Telegram данные получены:', {
        id: telegramUser.id,
        name: telegramUser.first_name,
        username: telegramUser.username
      });
    } catch (parseError) {
      console.error('❌ Ошибка парсинга Telegram данных:', parseError);
      return res.status(400).json({ 
        success: false,
        error: 'Неверные данные Telegram'
      });
    }
    
    if (!telegramUser.id || !telegramUser.first_name) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные данные пользователя'
      });
    }
    
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramUser.id]
    );
    
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      console.log(`👋 Найден существующий пользователь: ${user.first_name} (ID: ${user.id})`);
      
      await pool.query(
        `UPDATE users 
         SET username = $1, first_name = $2, last_name = $3 
         WHERE telegram_id = $4`,
        [
          telegramUser.username || user.username,
          telegramUser.first_name || user.first_name,
          telegramUser.last_name || user.last_name,
          telegramUser.id
        ]
      );
      
    } else {
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
      console.log(`✅ СОЗДАН НОВЫЙ ПОЛЬЗОВАТЕЛЬ: ${user.first_name} (Telegram ID: ${user.telegram_id})`);
      
      const currentMonth = new Date().toISOString().slice(0, 7);
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
      console.log(`📅 Создана подписка на месяц ${currentMonth}`);
    }
    
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
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Неверный или просроченный токен' });
    }
    
    const userId = payload.user_id;
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    let subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND month = $2`,
      [user.id, currentMonth]
    );
    
    if (subscriptionResult.rows.length === 0) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
      
      subscriptionResult = await pool.query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND month = $2`,
        [user.id, currentMonth]
      );
    }
    
    const subscription = subscriptionResult.rows[0];
    
    const partnersResult = await pool.query('SELECT * FROM partners WHERE is_active = true');
    
    const codesResult = await pool.query(
      `SELECT * FROM codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [user.id]
    );
    
    const paymentsResult = await pool.query(
      `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
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

// 5. СОЗДАНИЕ ПЛАТЕЖА ДЛЯ TBANK (НОВЫЙ ЭНДПОИНТ)
app.post('/api/create-payment', async (req, res) => {
  try {
    const { cups, amount } = req.body;
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
    
    console.log(`💰 Создание платежа: ${cups} чашек для пользователя ID: ${userId}`);
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const pricePerCup = 167;
    const totalAmount = amount || Math.round(pricePerCup * cups);
    
    // Создаем запись о платеже со статусом 'pending'
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, amount, cups_added, status, payment_method) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, totalAmount, cups, 'pending', 'tbank']
    );
    
    const payment = paymentResult.rows[0];
    
    // ВАЖНО: ВСТАВЬТЕ ВАШУ ССЫЛКУ TBank ЗДЕСЬ!
    const tbankUrl = `https://tbank.ru/cf/1QbMF9U9yHP?payment_id=${payment.id}&amount=${totalAmount}&cups=${cups}`;
    // ^ ЗАМЕНИТЕ 1QbMF9U9yHP НА ВАШУ ССЫЛКУ
    
    res.json({
      success: true,
      payment_id: payment.id,
      amount: totalAmount,
      cups: cups,
      payment_url: tbankUrl,
      return_url: `https://ваш-сайт.ru/payment-success/${payment.id}`,
      cancel_url: `https://ваш-сайт.ru/payment-cancel/${payment.id}`
    });
    
  } catch (error) {
    console.error('❌ Ошибка создания платежа:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. WEBHOOK ОТ TBANK ДЛЯ ПОДТВЕРЖДЕНИЯ ОПЛАТЫ
app.post('/api/tbank-webhook', async (req, res) => {
  try {
    const { payment_id, status, transaction_id } = req.body;
    
    console.log(`🔄 Webhook от TBank: платеж ${payment_id}, статус ${status}`);
    
    if (!payment_id) {
      return res.status(400).json({ error: 'Нет payment_id' });
    }
    
    const paymentResult = await pool.query(
      `SELECT * FROM payments WHERE id = $1`,
      [payment_id]
    );
    
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Платеж не найден' });
    }
    
    const payment = paymentResult.rows[0];
    
    if (status === 'success') {
      // Обновляем статус платежа
      await pool.query(
        `UPDATE payments SET 
          status = 'completed',
          transaction_id = $1,
          paid_at = NOW()
         WHERE id = $2`,
        [transaction_id, payment_id]
      );
      
      // Добавляем чашки пользователю
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // Обновляем подписку (связываем payment с subscription)
      const subscriptionResult = await pool.query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND month = $2`,
        [payment.user_id, currentMonth]
      );
      
      let subscriptionId;
      
      if (subscriptionResult.rows.length > 0) {
        subscriptionId = subscriptionResult.rows[0].id;
        await pool.query(
          `UPDATE subscriptions 
           SET cups_remaining = cups_remaining + $1,
               updated_at = NOW(),
               is_active = true
           WHERE user_id = $2 AND month = $3`,
          [payment.cups_added, payment.user_id, currentMonth]
        );
      } else {
        const newSubscription = await pool.query(
          `INSERT INTO subscriptions (user_id, cups_remaining, month, is_active) 
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [payment.user_id, payment.cups_added, currentMonth, true]
        );
        subscriptionId = newSubscription.rows[0].id;
      }
      
      // Обновляем subscription_id в платеже
      await pool.query(
        `UPDATE payments SET subscription_id = $1 WHERE id = $2`,
        [subscriptionId, payment_id]
      );
      
      console.log(`✅ Платеж ${payment_id} подтвержден, добавлено ${payment.cups_added} чашек`);
      
    } else if (status === 'failed' || status === 'canceled') {
      await pool.query(
        `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [payment_id]
      );
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Ошибка webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. ПРОВЕРКА СТАТУСА ПЛАТЕЖА
app.get('/api/payment-status/:paymentId', async (req, res) => {
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
    
    const paymentId = req.params.paymentId;
    
    const paymentResult = await pool.query(
      `SELECT * FROM payments WHERE id = $1 AND user_id = $2`,
      [paymentId, payload.user_id]
    );
    
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Платеж не найден' });
    }
    
    res.json(paymentResult.rows[0]);
    
  } catch (error) {
    console.error('❌ Ошибка проверки статуса:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. ГЕНЕРАЦИЯ КОДА (ВАШ ИСХОДНЫЙ КОД)
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
    
    const subscriptionResult = await pool.query(
      `SELECT cups_remaining FROM subscriptions WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    if (subscriptionResult.rows.length === 0 || subscriptionResult.rows[0].cups_remaining <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Недостаточно чашек для генерации кода' 
      });
    }
    
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
    
    const codeResult = await pool.query(
      `INSERT INTO codes (user_id, code, partner_name) VALUES ($1, $2, $3) RETURNING *`,
      [userId, code, partner_name]
    );
    
    console.log(`✅ Код сохранен: ${code} для партнера ${partner_name}`);
    
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining - 1,
           updated_at = NOW()
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    const updatedSubscription = await pool.query(
      `SELECT cups_remaining FROM subscriptions WHERE user_id = $1 AND month = $2`,
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

// 9. ИСТОРИЯ ПОЛЬЗОВАТЕЛЯ (ВАШ ИСХОДНЫЙ КОД)
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
    
    const codesResult = await pool.query(
      `SELECT * FROM codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    
    const paymentsResult = await pool.query(
      `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
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

// 10. ТЕСТОВАЯ ОПЛАТА (для разработки, если нужно)
app.post('/api/test-payment', async (req, res) => {
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
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const pricePerCup = 167;
    const totalAmount = Math.round(pricePerCup * cups);
    
    // Создаем тестовый платеж
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, amount, cups_added, status, payment_method, transaction_id, paid_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [userId, totalAmount, cups, 'completed', 'test', 'TEST_' + Date.now()]
    );
    
    const payment = paymentResult.rows[0];
    
    // Добавляем чашки
    const subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    let subscriptionId;
    
    if (subscriptionResult.rows.length > 0) {
      subscriptionId = subscriptionResult.rows[0].id;
      await pool.query(
        `UPDATE subscriptions 
         SET cups_remaining = cups_remaining + $1,
             updated_at = NOW(),
             is_active = true
         WHERE user_id = $2 AND month = $3`,
        [cups, userId, currentMonth]
      );
    } else {
      const newSubscription = await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month, is_active) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, cups, currentMonth, true]
      );
      subscriptionId = newSubscription.rows[0].id;
    }
    
    // Обновляем subscription_id
    await pool.query(
      `UPDATE payments SET subscription_id = $1 WHERE id = $2`,
      [subscriptionId, payment.id]
    );
    
    // Получаем обновленное состояние
    const updatedSubscription = await pool.query(
      `SELECT cups_remaining FROM subscriptions WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    res.json({
      success: true,
      message: `Тестовая оплата успешна: ${cups} чашек`,
      payment_id: payment.id,
      remaining: updatedSubscription.rows[0].cups_remaining
    });
    
  } catch (error) {
    console.error('❌ Ошибка тестовой оплаты:', error);
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
      console.log('💰 TBank оплата интегрирована');
    });
    
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
