const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:2005@localhost:5432/cinematch';
const DATA_DIR = path.join(process.cwd(), '.data');

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function initPostgresDB() {
  const client = await pool.connect();
  try {
    console.log('[db_init] Connecting to PostgreSQL at:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

    await client.query('BEGIN');

    // Create Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        password_hash TEXT,
        languages JSONB,
        occupation VARCHAR(255),
        state VARCHAR(255),
        date_of_birth VARCHAR(255),
        gender VARCHAR(50),
        feedback_count INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS movies (
        id INT PRIMARY KEY,
        tmdb_id INT,
        title VARCHAR(500) NOT NULL,
        overview TEXT,
        poster_url TEXT,
        backdrop_url TEXT,
        imdb_rating NUMERIC(3, 1),
        content_type VARCHAR(50) DEFAULT 'movie',
        release_date VARCHAR(50),
        director VARCHAR(255),
        cast_members JSONB,
        genres JSONB,
        platforms JSONB,
        popularity NUMERIC(10, 2) DEFAULT 50.0,
        status VARCHAR(50) DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS user_feedback (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        movie_id INT NOT NULL,
        watched INT NOT NULL,
        rating NUMERIC(3, 1),
        liked_aspects JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_taste_profiles (
        user_id VARCHAR(255) PRIMARY KEY,
        genre_affinity JSONB,
        preferred_directors JSONB,
        preferred_actors JSONB,
        plot_weight NUMERIC(3, 2) DEFAULT 0.2,
        direction_weight NUMERIC(3, 2) DEFAULT 0.2,
        acting_weight NUMERIC(3, 2) DEFAULT 0.2,
        vfx_weight NUMERIC(3, 2) DEFAULT 0.2,
        music_weight NUMERIC(3, 2) DEFAULT 0.2,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_watchlist (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        movie_id INT NOT NULL,
        status VARCHAR(50) NOT NULL,
        added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS movie_genres (
        movie_id INT NOT NULL,
        genre_id INT NOT NULL,
        PRIMARY KEY (movie_id, genre_id)
      );

      CREATE TABLE IF NOT EXISTS movie_ott_availability (
        movie_id INT NOT NULL,
        ott_platform_id INT NOT NULL,
        watch_url TEXT,
        availability_type VARCHAR(50) DEFAULT 'streaming',
        PRIMARY KEY (movie_id, ott_platform_id)
      );

      CREATE TABLE IF NOT EXISTS user_ott_subscriptions (
        user_id VARCHAR(255) NOT NULL,
        ott_platform_id INT NOT NULL,
        PRIMARY KEY (user_id, ott_platform_id)
      );

      CREATE TABLE IF NOT EXISTS watch_events (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        movie_id INT NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // Helper to read JSON file
    function readJson(filename) {
      const file = path.join(DATA_DIR, filename);
      if (!fs.existsSync(file)) return [];
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return [];
      }
    }

    // 1. Migrate Users
    const users = readJson('users.json');
    for (const u of users) {
      await client.query(`
        INSERT INTO users (id, email, password_hash, languages, occupation, state, date_of_birth, gender, feedback_count, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          languages = EXCLUDED.languages,
          feedback_count = EXCLUDED.feedback_count;
      `, [
        u.id, u.email, u.password_hash || null,
        JSON.stringify(u.languages || []), u.occupation || null, u.state || null,
        u.date_of_birth || null, u.gender || null, u.feedback_count || 0, u.created_at || new Date()
      ]);
    }

    // 2. Migrate Movies
    const movies = readJson('movies.json');
    for (const m of movies) {
      await client.query(`
        INSERT INTO movies (id, tmdb_id, title, overview, poster_url, backdrop_url, imdb_rating, content_type, release_date, director, cast_members, genres, platforms, popularity, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          imdb_rating = EXCLUDED.imdb_rating,
          cast_members = EXCLUDED.cast_members,
          genres = EXCLUDED.genres,
          platforms = EXCLUDED.platforms;
      `, [
        m.id, m.tmdb_id || m.id, m.title, m.overview || '', m.poster_url || '', m.backdrop_url || '',
        m.imdb_rating || 5.0, m.content_type || 'movie', m.release_date || '', m.director || '',
        JSON.stringify(m.cast_members || []), JSON.stringify(m.genres || []), JSON.stringify(m.platforms || []),
        m.popularity || 50.0, m.status || 'active'
      ]);
    }

    // 3. Migrate Feedback
    const feedback = readJson('user_feedback.json');
    for (const f of feedback) {
      await client.query(`
        INSERT INTO user_feedback (id, user_id, movie_id, watched, rating, liked_aspects, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING;
      `, [
        f.id, f.user_id, f.movie_id, f.watched ? 1 : 0, f.rating || null,
        JSON.stringify(f.liked_aspects || []), f.created_at || new Date()
      ]);
    }

    // 4. Migrate Taste Profiles
    const profiles = readJson('user_taste_profiles.json');
    for (const p of profiles) {
      await client.query(`
        INSERT INTO user_taste_profiles (user_id, genre_affinity, preferred_directors, preferred_actors, plot_weight, direction_weight, acting_weight, vfx_weight, music_weight, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
          genre_affinity = EXCLUDED.genre_affinity,
          preferred_directors = EXCLUDED.preferred_directors,
          preferred_actors = EXCLUDED.preferred_actors,
          plot_weight = EXCLUDED.plot_weight,
          direction_weight = EXCLUDED.direction_weight,
          acting_weight = EXCLUDED.acting_weight,
          vfx_weight = EXCLUDED.vfx_weight,
          music_weight = EXCLUDED.music_weight;
      `, [
        p.user_id, JSON.stringify(p.genre_affinity || {}), JSON.stringify(p.preferred_directors || []),
        JSON.stringify(p.preferred_actors || []), p.plot_weight || 0.2, p.direction_weight || 0.2,
        p.acting_weight || 0.2, p.vfx_weight || 0.2, p.music_weight || 0.2, p.updated_at || new Date()
      ]);
    }

    // 5. Migrate Watchlist
    const crypto = require('crypto');
    const watchlist = readJson('user_watchlist.json');
    for (const w of watchlist) {
      await client.query(`
        INSERT INTO user_watchlist (id, user_id, movie_id, status, added_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING;
      `, [w.id || crypto.randomUUID(), w.user_id, w.movie_id, w.status, w.added_at || new Date()]);
    }

    // 6. Migrate Movie Genres
    const movieGenres = readJson('movie_genres.json');
    for (const mg of movieGenres) {
      await client.query(`
        INSERT INTO movie_genres (movie_id, genre_id)
        VALUES ($1, $2)
        ON CONFLICT (movie_id, genre_id) DO NOTHING;
      `, [mg.movie_id, mg.genre_id]);
    }

    // 7. Migrate OTT Availability
    const ottAvail = readJson('movie_ott_availability.json');
    for (const a of ottAvail) {
      await client.query(`
        INSERT INTO movie_ott_availability (movie_id, ott_platform_id, watch_url, availability_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (movie_id, ott_platform_id) DO NOTHING;
      `, [a.movie_id, a.ott_platform_id, a.watch_url || '', a.availability_type || 'streaming']);
    }

    // 8. Migrate User Subscriptions
    const userSubs = readJson('user_ott_subscriptions.json');
    for (const s of userSubs) {
      await client.query(`
        INSERT INTO user_ott_subscriptions (user_id, ott_platform_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, ott_platform_id) DO NOTHING;
      `, [s.user_id, s.ott_platform_id]);
    }

    // 9. Migrate Watch Events
    const events = readJson('watch_events.json');
    for (const e of events) {
      await client.query(`
        INSERT INTO watch_events (id, user_id, movie_id, event_type, timestamp)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING;
      `, [e.id || crypto.randomUUID(), e.user_id, e.movie_id, e.event_type || 'watch', e.timestamp || new Date()]);
    }

    await client.query('COMMIT');
    console.log('[db_init] ✅ PostgreSQL tables created and data seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db_init] ❌ Error initializing PostgreSQL:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  initPostgresDB();
}

module.exports = { initPostgresDB };
