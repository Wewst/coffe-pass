const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Логирование
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Подключение к PostgreSQL Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// JWT секрет (в Railway добавь переменную JWT_SECRET)
const JWT_SECRET = process.env.JWT_SECRET || 'coffeepass-secret-key-2025';

// ============ СОЗДАНИЕ ТАБЛИЦ ПРИ ЗАПУСКЕ ============
async function initDatabase() {
  console.log('🔄 Создаем таблицы если нет...');
  
  try {
    // 1. Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // 2. Таблица подписок
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
    
    // 3. Таблица платежей
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
    
    // 4. Таблица кодов
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
    
    // 5. Таблица партнеров (фиксированная)
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
    
    console.log('✅ Все таблицы готовы');
    
    const partnersResult = await pool.query('SELECT COUNT(*) FROM partners');
    console.log(`📊 Партнеров в базе: ${partnersResult.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// ============ API РОУТЫ ============

// 1. Здоровье
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

// 2. Получить партнеров
app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners WHERE is_active = true');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Авторизация Telegram
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body;
    
    const userMatch = initData.match(/user=([^&]*)/);
    if (!userMatch) return res.status(400).json({ error: 'Нет данных пользователя' });
    
    const userData = JSON.parse(decodeURIComponent(userMatch[1]));
    console.log(`🔑 Авторизация: ${userData.first_name} (${userData.id})`);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userData.id]
    );
    
    let user;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [userData.id, userData.username, userData.first_name, userData.last_name]
      );
      user = newUser.rows[0];
      console.log(`✅ Новый пользователь: ${user.first_name}`);
    } else {
      user = userResult.rows[0];
      console.log(`👋 Возвращающийся: ${user.first_name}`);
    }
    
    const token = jwt.sign(
      { telegram_id: user.telegram_id, user_id: user.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
});

// 4. Получить состояние пользователя
app.get('/api/user/state', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Нет токена' });
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [decoded.telegram_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    const subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND month = $2`,
      [user.id, currentMonth]
    );
    
    let state = {
      purchased: false,
      remaining: 0,
      month: currentMonth,
      user: { id: user.id, first_name: user.first_name }
    };
    
    if (subscriptionResult.rows.length > 0) {
      const sub = subscriptionResult.rows[0];
      state.purchased = true;
      state.remaining = sub.cups_remaining;
      state.subscription = sub;
    }
    
    const partnersResult = await pool.query('SELECT * FROM partners WHERE is_active = true');
    state.partners = partnersResult.rows;
    
    res.json(state);
    
  } catch (error) {
    console.error('❌ Ошибка получения состояния:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// 5. ПОКУПКА
app.post('/api/purchase', async (req, res) => {
  try {
    const { cups, token } = req.body;
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [decoded.telegram_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    console.log(`💰 Покупка: ${user.first_name} - ${cups} чашек`);
    
    const pricePerCup = 167;
    const totalPrice = Math.round(pricePerCup * cups);
    
    const subResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND month = $2`,
      [user.id, currentMonth]
    );
    
    let subscription;
    let cupsAdded = cups;
    
    if (subResult.rows.length > 0) {
      subscription = subResult.rows[0];
      const newRemaining = Math.min(subscription.cups_remaining + cups, 12);
      cupsAdded = newRemaining - subscription.cups_remaining;
      
      await pool.query(
        `UPDATE subscriptions 
         SET cups_remaining = $1, updated_at = NOW() 
         WHERE id = $2`,
        [newRemaining, subscription.id]
      );
      
      subscription.cups_remaining = newRemaining;
    } else {
      const newSub = await pool.query(
        `INSERT INTO subscriptions 
         (user_id, cups_remaining, price_paid, month) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [user.id, cups, totalPrice, currentMonth]
      );
      subscription = newSub.rows[0];
    }
    
    const paymentResult = await pool.query(
      `INSERT INTO payments 
       (user_id, subscription_id, amount, cups_added, status) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.id, subscription.id, totalPrice, cupsAdded, 'completed']
    );
    
    console.log(`✅ Платеж сохранен: ID ${paymentResult.rows[0].id}, ${totalPrice}₽`);
    
    res.json({
      success: true,
      message: `Оплачено ${cupsAdded} чашек`,
      remaining: subscription.cups_remaining,
      payment_id: paymentResult.rows[0].id
    });
    
  } catch (error) {
    console.error('❌ Ошибка покупки:', error);
    res.status(500).json({ error: 'Ошибка обработки покупки' });
  }
});

// 6. Генерация кода
app.post('/api/codes/generate', async (req, res) => {
  try {
    const { partner_name, token } = req.body;
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [decoded.telegram_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const subResult = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND month = $2`,
      [user.id, currentMonth]
    );
    
    if (subResult.rows.length === 0 || subResult.rows[0].cups_remaining <= 0) {
      return res.status(400).json({ error: 'Нет доступных чашек' });
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
      `INSERT INTO codes (user_id, code, partner_name) 
       VALUES ($1, $2, $3) RETURNING *`,
      [user.id, code, partner_name]
    );
    
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining - 1 
       WHERE user_id = $1 AND is_active = true AND month = $2`,
      [user.id, currentMonth]
    );
    
    console.log(`✅ Код сохранен: ${code} для ${user.first_name}`);
    
    res.json({
      success: true,
      code: { code, id: codeResult.rows[0].id },
      message: 'Код сгенерирован'
    });
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    res.status(500).json({ error: 'Ошибка генерации кода' });
  }
});

// 7. История
app.get('/api/history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Нет токена' });
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [decoded.telegram_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    const codesResult = await pool.query(
      `SELECT code, is_used, used_at, created_at, partner_name 
       FROM codes WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    
    const paymentsResult = await pool.query(
      `SELECT amount, cups_added, created_at 
       FROM payments WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    
    res.json({
      codes: codesResult.rows,
      payments: paymentsResult.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения истории:', error);
    res.status(500).json({ error: 'Ошибка получения истории' });
  }
});

// ============ ЗАПУСК СЕРВЕРА ============
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
      console.log(`🔗 Health: /api/health`);
      console.log(`👥 Партнеры: /api/partners`);
      console.log(`💰 Все данные сохраняются в PostgreSQL!`);
    });
    
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
  }
}

startServer();
