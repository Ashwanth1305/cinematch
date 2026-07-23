'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Image from 'next/image';

function getImageUrl(path) {
  if (!path) return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="500" height="750"%3E%3Crect fill="%231a1a2e" width="500" height="750"/%3E%3Ctext x="250" y="375" text-anchor="middle" fill="%236b6b82" font-size="24"%3E🎬%3C/text%3E%3C/svg%3E';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

function getBackdropUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w1280${path}`;
}

function getRatingClass(rating) {
  if (rating >= 7.5) return 'rating-high';
  if (rating >= 5.5) return 'rating-mid';
  return 'rating-low';
}

const PLATFORM_ICONS = {
  'Netflix': '🟥', 'Prime Video': '🔵', 'Hotstar': '🌟',
  'Jio Cinema': '🟣', 'Zee5': '🟪', 'SonyLIV': '🔴',
  'Apple TV+': '🍎', 'Lionsgate Play': '🦁'
};

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const movieId = params.movieId;
  const [movie, setMovie] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchShareData = async () => {
      try {
        const res = await fetch(`/api/share?movieId=${movieId}`);
        const data = await res.json();
        if (active) {
          setMovie(data.movie);
          setShareData(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    if (movieId) {
      void fetchShareData();
    }

    return () => {
      active = false;
    };
  }, [movieId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareData?.shareLinks?.copy || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = shareData?.shareLinks?.copy || window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <p>Loading recommendation...</p>
      </div>
    );
  }

  if (!movie) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: 16 }}>🎬</div>
          <h2>Movie not found</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, marginBottom: 24 }}>
            This shared link may have expired or the movie may no longer be available.
          </p>
          <button className="btn btn-primary" onClick={() => router.push('/')}>
            Discover Movies on CineMatch
          </button>
        </div>
      </div>
    );
  }

  const backdrop = getBackdropUrl(movie.backdrop_url);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>
      {/* Backdrop hero */}
      {backdrop && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 400,
          backgroundImage: `url(${backdrop})`, backgroundSize: 'cover', backgroundPosition: 'center',
          zIndex: 0
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(transparent 20%, var(--bg-primary) 100%)'
          }} />
        </div>
      )}

      {/* Navbar */}
      <nav style={{
        height: 'var(--nav-height)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 32px',
        position: 'relative', zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => router.push('/')}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-md)',
            background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem'
          }}>🎬</div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 800 }}>
            Cine<span className="gradient-text">Match</span>
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
          Join CineMatch
        </button>
      </nav>

      {/* Content */}
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '60px 24px', position: 'relative', zIndex: 1
      }}>
        {/* Shared by badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 18px', borderRadius: 'var(--radius-full)',
          background: 'rgba(124, 58, 237, 0.12)', border: '1px solid rgba(124, 58, 237, 0.25)',
          color: 'var(--accent-primary-light)', fontSize: '0.85rem', fontWeight: 600, marginBottom: 24
        }}>
          🎬 Shared via CineMatch
        </div>

        <div style={{
          display: 'flex', gap: 24, marginBottom: 32,
          flexWrap: 'wrap'
        }}>
          {/* Poster */}
          <div style={{
            width: 220, flexShrink: 0, borderRadius: 'var(--radius-xl)',
            overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            border: '2px solid rgba(255,255,255,0.08)'
          }}>
            <Image width={500} height={750}
              src={getImageUrl(movie.poster_url)}
              alt={movie.title}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 250 }}>
            <h1 style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', marginBottom: 12, lineHeight: 1.2 }}>
              {movie.title}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span className={`rating-badge ${getRatingClass(movie.imdb_rating)}`}>
                ⭐ {movie.imdb_rating?.toFixed(1)} IMDb
              </span>
              {movie.release_date && (
                <span className="badge">{new Date(movie.release_date).getFullYear()}</span>
              )}
              <span className="badge">{movie.content_type === 'series' ? '📺 Series' : '🎬 Movie'}</span>
            </div>

            {/* Genre tags */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {(movie.genres || []).map((g, i) => (
                <span key={i} style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-full)',
                  background: 'rgba(124, 58, 237, 0.1)', border: '1px solid rgba(124, 58, 237, 0.2)',
                  color: 'var(--accent-primary-light)', fontSize: '0.75rem', fontWeight: 500
                }}>
                  {typeof g === 'string' ? g : g.name || g}
                </span>
              ))}
            </div>

            {movie.overview && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: 16 }}>
                {movie.overview}
              </p>
            )}

            {movie.director && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 4 }}>
                Director: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{movie.director}</span>
              </p>
            )}
            {movie.cast_members && Array.isArray(movie.cast_members) && movie.cast_members.length > 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
                Cast: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{movie.cast_members.join(', ')}</span>
              </p>
            )}

            {/* Platforms */}
            {movie.platforms && movie.platforms.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Available on
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {movie.platforms.map((p, i) => (
                    <span key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 16px', background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-full)',
                      fontSize: '0.85rem', fontWeight: 500
                    }}>
                      {PLATFORM_ICONS[p.name] || '📺'} {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Share actions */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)', padding: 24
        }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Share this recommendation</h3>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {shareData?.shareLinks?.whatsapp && (
              <a href={shareData.shareLinks.whatsapp} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                💬 WhatsApp
              </a>
            )}
            {shareData?.shareLinks?.twitter && (
              <a href={shareData.shareLinks.twitter} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                𝕏 Twitter
              </a>
            )}
            {shareData?.shareLinks?.telegram && (
              <a href={shareData.shareLinks.telegram} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                ✈️ Telegram
              </a>
            )}
            <button className="btn btn-secondary" onClick={handleCopy}>
              {copied ? '✅ Copied!' : '📋 Copy Link'}
            </button>
          </div>

          {/* CTA */}
          <div style={{
            padding: 20, background: 'var(--accent-gradient-subtle)',
            border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-lg)',
            textAlign: 'center'
          }}>
            <p style={{ marginBottom: 12, fontSize: '0.95rem' }}>
              Get personalized movie recommendations across all your streaming platforms
            </p>
            <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
              🚀 Join CineMatch — It&apos;s Free
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ padding: 40, textAlign: 'center', borderTop: '1px solid var(--border-color)' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          © 2025 CineMatch. Built with ❤️ for movie lovers.
        </p>
      </footer>
    </div>
  );
}
