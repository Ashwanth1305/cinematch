-- ============================================
-- CineMatch Database Schema
-- PostgreSQL
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    auth_provider VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google', 'apple')),
    feedback_count INTEGER NOT NULL DEFAULT 0,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- OTT_PLATFORMS
-- ============================================
CREATE TABLE ott_platforms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    logo_url VARCHAR(500),
    deep_link_scheme VARCHAR(100),
    web_base_url VARCHAR(500),
    tmdb_provider_id INTEGER NOT NULL UNIQUE
);

-- Pre-seed OTT platforms (TMDB provider IDs for India region)
INSERT INTO ott_platforms (name, logo_url, deep_link_scheme, web_base_url, tmdb_provider_id) VALUES
    ('Netflix',        '/platforms/netflix.svg',        'netflix://',        'https://www.netflix.com',         8),
    ('Prime Video',    '/platforms/prime-video.svg',     'primevideo://',     'https://www.primevideo.com',      119),
    ('JioHotstar',     '/platforms/jiohotstar.svg',      'hotstar://',        'https://www.jiohotstar.com',      122),
    ('Zee5',           '/platforms/zee5.svg',            'zee5://',           'https://www.zee5.com',            232),
    ('SonyLIV',        '/platforms/sonyliv.svg',         'sonyliv://',        'https://www.sonyliv.com',         237),
    ('Apple TV+',      '/platforms/apple-tv.svg',        'appletv://',        'https://tv.apple.com',            350),
    ('Lionsgate Play', '/platforms/lionsgate.svg',       'lionsgateplay://',  'https://www.lionsgateplay.com',   561);

-- ============================================
-- USER_OTT_SUBSCRIPTIONS
-- ============================================
CREATE TABLE user_ott_subscriptions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ott_platform_id INTEGER NOT NULL REFERENCES ott_platforms(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, ott_platform_id)
);

CREATE INDEX idx_user_ott_user ON user_ott_subscriptions(user_id);

-- ============================================
-- GENRES
-- ============================================
CREATE TABLE genres (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    icon VARCHAR(10),
    tmdb_genre_id INTEGER UNIQUE
);

-- Pre-seed genres (TMDB genre IDs)
INSERT INTO genres (name, slug, icon, tmdb_genre_id) VALUES
    ('Action',      'action',      '⚡', 28),
    ('Comedy',      'comedy',      '😂', 35),
    ('Horror',      'horror',      '👻', 27),
    ('Thriller',    'thriller',    '🔪', 53),
    ('Romance',     'romance',     '💕', 10749),
    ('Drama',       'drama',       '🎭', 18),
    ('Sci-Fi',      'sci-fi',      '🚀', 878),
    ('Crime',       'crime',       '🔫', 80),
    ('Documentary', 'documentary', '📹', 99),
    ('Animation',   'animation',   '🎨', 16);

-- ============================================
-- MOVIES
-- ============================================
CREATE TABLE movies (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    overview TEXT,
    poster_url VARCHAR(500),
    backdrop_url VARCHAR(500),
    imdb_rating FLOAT DEFAULT 0,
    content_type VARCHAR(10) NOT NULL DEFAULT 'movie' CHECK (content_type IN ('movie', 'series')),
    release_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    leaving_date DATE,
    coming_date DATE,
    director VARCHAR(255),
    cast_members TEXT, -- JSON array of top cast names
    keywords TEXT, -- JSON array of keyword strings
    budget BIGINT DEFAULT 0,
    vfx_heavy BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_movies_tmdb ON movies(tmdb_id);
CREATE INDEX idx_movies_status ON movies(status);
CREATE INDEX idx_movies_imdb ON movies(imdb_rating DESC);
CREATE INDEX idx_movies_content_type ON movies(content_type);

-- ============================================
-- MOVIE_GENRES (Junction Table)
-- ============================================
CREATE TABLE movie_genres (
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (movie_id, genre_id)
);

CREATE INDEX idx_movie_genres_genre ON movie_genres(genre_id);

-- ============================================
-- MOVIE_OTT_AVAILABILITY
-- ============================================
CREATE TYPE availability_type_enum AS ENUM ('streaming', 'coming_soon', 'leaving_soon');

CREATE TABLE movie_ott_availability (
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    ott_platform_id INTEGER NOT NULL REFERENCES ott_platforms(id) ON DELETE CASCADE,
    watch_url VARCHAR(500),
    availability_type availability_type_enum NOT NULL DEFAULT 'streaming',
    PRIMARY KEY (movie_id, ott_platform_id)
);

CREATE INDEX idx_movie_ott_platform ON movie_ott_availability(ott_platform_id, availability_type);

-- ============================================
-- USER_FEEDBACK
-- ============================================
CREATE TABLE user_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    watched BOOLEAN NOT NULL DEFAULT FALSE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 10),
    liked_aspects JSONB, -- e.g. ["plot", "direction", "acting"]
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feedback_user ON user_feedback(user_id);
CREATE INDEX idx_feedback_movie ON user_feedback(movie_id);

-- ============================================
-- USER_WATCHLIST
-- ============================================
CREATE TYPE watchlist_status_enum AS ENUM ('going_to_watch', 'watched', 'skipped');

CREATE TABLE user_watchlist (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    status watchlist_status_enum NOT NULL DEFAULT 'going_to_watch',
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id)
);

CREATE INDEX idx_watchlist_user_status ON user_watchlist(user_id, status);

-- ============================================
-- USER_TASTE_PROFILE (1:1 with USERS)
-- ============================================
CREATE TABLE user_taste_profile (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    genre_affinity JSONB DEFAULT '{}', -- e.g. {"action": 0.8, "comedy": 0.6}
    plot_weight FLOAT DEFAULT 0.2,
    direction_weight FLOAT DEFAULT 0.2,
    acting_weight FLOAT DEFAULT 0.2,
    vfx_weight FLOAT DEFAULT 0.2,
    music_weight FLOAT DEFAULT 0.2,
    preferred_directors JSONB DEFAULT '[]',
    preferred_actors JSONB DEFAULT '[]',
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- WATCH_EVENTS (for tracking platform preferences)
-- ============================================
CREATE TABLE watch_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    platform_id INTEGER NOT NULL REFERENCES ott_platforms(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_watch_events_user ON watch_events(user_id);

-- ============================================
-- USER_NOTIFICATIONS (for Coming Soon alerts)
-- ============================================
CREATE TABLE user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    notify_on DATE NOT NULL,
    sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_date ON user_notifications(notify_on, sent);

-- ============================================
-- FEEDBACK_DISMISSALS (track modal dismissal count)
-- ============================================
CREATE TABLE feedback_dismissals (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    dismissal_count INTEGER NOT NULL DEFAULT 1,
    last_dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id)
);
