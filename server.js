const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
// Railway сам назначает порт через переменную PORT
const PORT = process.env.PORT || 10000; // 10000 стандартный порт Railway

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

// JWT секрет
const JWT_SECRET = process.env.JWT_SECRET || 'coffeepass-secret-key-2025';

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function initDatabase() {
  console.log('🔄 Создаем таблицы если нет...');
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
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
      
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        amount INTEGER NOT NULL,
        cups_added INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        code VARCHAR(20) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT false,
        used_at TIMESTAMP,
        partner_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
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

app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners WHERE is_active = true');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// Запускаем инициализацию БД и сервер
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
      console.log(`✅ Готов к работе!`);
    });
    
    // Добавляем обработку ошибок
    process.on('SIGTERM', () => {
      console.log('🛑 Получен SIGTERM, завершаем...');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('🛑 Получен SIGINT, завершаем...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

// ТОЧКА ВХОДА - сразу запускаем
startServer();
