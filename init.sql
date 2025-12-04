-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    language_code VARCHAR(10),
    is_premium BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица подписок
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

-- Таблица платежей
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    subscription_id INTEGER REFERENCES subscriptions(id),
    amount INTEGER NOT NULL,
    cups_added INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'completed',
    payment_method VARCHAR(50),
    transaction_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица кодов
CREATE TABLE IF NOT EXISTS codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    is_used BOOLEAN DEFAULT false,
    used_at TIMESTAMP,
    partner_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица партнеров
CREATE TABLE IF NOT EXISTS partners (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Добавляем тестовых партнеров
INSERT INTO partners (name, description, address) VALUES
('Кофейня на Набережной', 'Уют у Камской набережной', 'ул. Набережная, 12'),
('Teatral Coffee', 'Рядом с театром', 'ул. Театральная, 5'),
('Горка Кофе', 'Терраса у памятника', 'пл. Ворота, 1'),
('Кофе и Пермь', 'Классика в центре', 'ул. Ленина, 44');
