'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import styles from './home.module.css';

const GENRE_CONFIG = [
  { slug: 'action',      name: 'Action',      icon: '⚡' },
  { slug: 'comedy',      name: 'Comedy',      icon: '😂' },
  { slug: 'horror',      name: 'Horror',      icon: '👻' },
  { slug: 'thriller',    name: 'Thriller',     icon: '🔪' },
  { slug: 'romance',     name: 'Romance',      icon: '💕' },
  { slug: 'drama',       name: 'Drama',        icon: '🎭' },
  { slug: 'sci-fi',      name: 'Sci-Fi',       icon: '🚀' },
  { slug: 'crime',       name: 'Crime',        icon: '🔫' },
];

const PLATFORM_ICONS = {
  'Netflix': '🟥',
  'Prime Video': '🔵',
  'Hotstar': '🌟',
  'Jio Cinema': '🟣',
  'Zee5': '🟪',
  'SonyLIV': '🔴',
  'Apple TV+': '🍎',
  'Lionsgate Play': '🦁'
};

function getRatingClass(rating) {
  if (rating >= 7.5) return 'rating-high';
  if (rating >= 5.5) return 'rating-mid';
  return 'rating-low';
}

function getImageUrl(path) {
  if (!path) return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="450"%3E%3Crect fill="%231a1a2e" width="300" height="450"/%3E%3Ctext x="150" y="225" text-anchor="middle" fill="%236b6b82" font-size="16"%3E🎬%3C/text%3E%3C/svg%3E';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w342${path}`;
}

function getBackdropUrl(path) {
  if (!path) return getImageUrl(null);
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w780${path}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function HomePage() {
  const { user, loading: authLoading, logout, updateUserData } = useAuth();
  const router = useRouter();
  const [genreData, setGenreData] = useState({});
  const [trending, setTrending] = useState([]);
  const [comingSoon, setComingSoon] = useState([]);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showPlatformModal, setShowPlatformModal] = useState(null);
  const [showFeedback, setShowFeedback] = useState(null);
  const [feedbackData, setFeedbackData] = useState({ watched: null, rating: 0, aspects: [] });
  const [toast, setToast] = useState(null);
  const [blending, setBlending] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const uid = user?.id;
      if (!uid) return;

      const [genresRes, trendingRes, comingRes, leavingRes, recommendedRes] = await Promise.all([
        fetch(`/api/movies?userId=${uid}`, { cache: 'no-store' }),
        fetch(`/api/movies?type=trending&userId=${uid}`),
        fetch(`/api/movies?type=coming_soon&userId=${uid}`),
        fetch(`/api/movies?type=leaving_soon&userId=${uid}`),
        fetch(`/api/recommendations?userId=${uid}&limit=8`, { cache: 'no-store' }),
      ]);

      const genresJson = await genresRes.json();
      const trendingJson = await trendingRes.json();
      const comingJson = await comingRes.json();
      const leavingJson = await leavingRes.json();
      const recommendedJson = await recommendedRes.json();

      setGenreData(genresJson.genres || {});
      setTrending(trendingJson.movies || []);
      setComingSoon(comingJson.movies || []);
      setLeavingSoon(leavingJson.movies || []);
      setRecommended(recommendedJson.movies || []);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleSelectMovie = async (movie) => {
    if (!movie) return;
    setSelectedMovie(movie);
    // Always fetch full details from TMDB (director, cast, platforms)
    try {
      const res = await fetch(`/api/movies?id=${movie.id || movie.tmdb_id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.movie) {
          setSelectedMovie(data.movie);
        }
      }
    } catch (err) {
      console.error('Error fetching movie details:', err);
    }
  };

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push('/');
      return;
    }

    if (!user.onboarding_completed) {
      router.push('/onboarding/platforms');
      return;
    }

    let active = true;
    const load = async () => {
      await fetchData();
      if (!active) return;
    };

    void load();
    return () => {
      active = false;
    };
  }, [authLoading, user, router, fetchData]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleWatchClick = (movie) => {
    if (!movie.platforms || movie.platforms.length === 0) {
      showToast('No streaming platform available', 'error');
      return;
    }
    if (movie.platforms.length === 1) {
      handleRedirect(movie, movie.platforms[0]);
    } else {
      setShowPlatformModal(movie);
    }
  };

  const handleRedirect = async (movie, platform) => {
    showToast(`Added to watchlist! Redirecting to ${platform.name}...`);
    setShowPlatformModal(null);
    setSelectedMovie(null);

    // Save to watchlist via API
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, movieId: movie.id, platformId: platform.id })
      });
    } catch (err) {
      console.error('Failed to save to watchlist:', err);
    }

    // Redirect to OTT platform
    setTimeout(() => {
      const urls = {
        'Netflix': 'https://www.netflix.com',
        'Prime Video': 'https://www.primevideo.com',
        'Hotstar': 'https://www.hotstar.com',
        'Jio Cinema': 'https://www.jiocinema.com',
        'Zee5': 'https://www.zee5.com',
        'SonyLIV': 'https://www.sonyliv.com',
        'Apple TV+': 'https://tv.apple.com',
        'Lionsgate Play': 'https://www.lionsgateplay.com'
      };
      window.open(urls[platform.name] || '#', '_blank');
    }, 1000);

    // Prompt feedback after 3 seconds
    setTimeout(() => {
      setShowFeedback(movie);
    }, 3000);
  };

  const handleFeedbackSubmit = async () => {
    if (feedbackData.watched === true && feedbackData.rating === 0) {
      showToast('Please rate the movie before submitting.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          movieId: showFeedback.id,
          watched: feedbackData.watched,
          rating: feedbackData.rating,
          likedAspects: feedbackData.aspects
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Feedback submission failed');
      }

      const newCount = (user.feedback_count || 0) + 1;
      updateUserData({ feedback_count: newCount });

      // Feedback changes the persisted taste profile. Reload the feed so the
      // user sees the newly ranked recommendations immediately.
      await fetchData();

      if (newCount === 3) {
        showToast('🎯 Personalized recommendations unlocked! Your feed is now AI-powered.', 'success');
      } else {
        showToast('Thanks for your feedback! 🎬');
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      showToast(err.message || 'Could not save feedback', 'error');
    }
    setShowFeedback(null);
    setFeedbackData({ watched: null, rating: 0, aspects: [] });
  };

  const toggleAspect = (aspect) => {
    setFeedbackData(prev => ({
      ...prev,
      aspects: prev.aspects.includes(aspect)
        ? prev.aspects.filter(a => a !== aspect)
        : [...prev.aspects, aspect]
    }));
  };

  const handleSearch = (value) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!value.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSearchResults(data.movies || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  if (authLoading || loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading your personalized feed...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={styles.homePage}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <div className={styles.logoIcon}>🎬</div>
          <span className={styles.logoText}>Cine<span className="gradient-text">Match</span></span>
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative', flex: '0 1 360px' }}>
          <input
            className="input"
            placeholder="🔍 Search movies, actors, directors..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setShowSearch(true)}
            style={{ fontSize: '0.85rem', padding: '8px 16px', background: 'var(--bg-tertiary)' }}
          />
          {showSearch && searchQuery.trim() && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
              maxHeight: 400, overflowY: 'auto', background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-xl)', zIndex: 200, padding: 8
            }}>
              {searching ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Searching...</div>
              ) : searchResults.length > 0 ? (
                searchResults.slice(0, 8).map(movie => (
                  <div
                    key={movie.id}
                    onClick={() => { handleSelectMovie(movie); setShowSearch(false); setSearchQuery(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Image src={getImageUrl(movie.poster_url)} alt="" width={36} height={54} style={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{movie.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {movie.director && `${movie.director} · `}⭐ {movie.imdb_rating?.toFixed(1)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No results found</div>
              )}
            </div>
          )}
        </div>

        <div className={styles.navRight}>
          <button className={styles.navBtn} onClick={() => router.push('/explore')}>
            🎲 <span>Surprise Me</span>
          </button>
          <button className={styles.navBtn} onClick={() => router.push('/watchlist')}>
            📋 <span>Watchlist</span>
          </button>
          <button className={styles.navBtn} onClick={() => router.push('/settings')}>
            ⚙️ <span>Settings</span>
          </button>
          <div style={{ position: 'relative' }}>
            <button className={styles.avatarBtn} onClick={() => setShowDropdown(!showDropdown)}>
              {user.name?.[0]?.toUpperCase() || '?'}
            </button>
            {showDropdown && (
              <div className={styles.dropdownMenu}>
                <div className={styles.dropdownItem} style={{ cursor: 'default' }}>
                  <span>👤</span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.name}</div>
                    <div style={{ fontSize: '0.75rem' }}>{user.email}</div>
                  </div>
                </div>
                <div className={styles.dropdownDivider} />
                <button className={styles.dropdownItem} onClick={() => { router.push('/settings'); setShowDropdown(false); }}>
                  <span>⚙️</span> Settings
                </button>
                <button className={styles.dropdownItem} onClick={() => { router.push('/watchlist'); setShowDropdown(false); }}>
                  <span>📋</span> My Watchlist
                </button>
                <div className={styles.dropdownDivider} />
                <button className={styles.dropdownItem} onClick={() => { logout(); router.push('/'); }}>
                  <span>🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Click outside to close dropdown */}
      {showDropdown && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowDropdown(false)} />
      )}

      {/* Personalization Status Banner */}
      {user.feedback_count >= 3 && (
        <div className={styles.reminderBanner}>
          <span>🧠</span>
          <p>
            <strong>AI-Personalized Feed</strong> — Your recommendations are {Math.round((1 - 0.55 + Math.min(0.35, (user.feedback_count - 3) * 0.05)) * 100)}% personalized
            {user.feedback_count < 10 && ` · Rate ${10 - user.feedback_count} more to reach full AI mode`}
          </p>
        </div>
      )}
      {user.feedback_count > 0 && user.feedback_count < 3 && (
        <div className={styles.reminderBanner}>
          <span>💡</span>
          <p>Rate <strong>{3 - user.feedback_count}</strong> more movie{3 - user.feedback_count !== 1 ? 's' : ''} to unlock <strong>AI-personalized</strong> recommendations!</p>
        </div>
      )}

      <div className={styles.content}>
        {recommended.length > 0 && (
          <section className={styles.trendingSection}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.sectionIcon}>🧠</span>
                Recommended for You
              </h2>
            </div>
            <CarouselRow>
              {recommended.map((movie) => (
                <div key={movie.id} className={styles.trendingCard} onClick={() => handleSelectMovie(movie)}>
                  <Image width={780} height={439}
                    className={styles.trendingBackdrop}
                    src={getBackdropUrl(movie.backdrop_url || movie.poster_url)}
                    alt={movie.title}
                    loading="lazy"
                  />
                  <div className={styles.trendingOverlay}>
                    <div className={styles.trendingTitle}>{movie.title}</div>
                    <div className={styles.trendingMeta}>
                      <span className={`rating-badge ${getRatingClass(movie.imdb_rating)}`}>
                        ⭐ {movie.imdb_rating?.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </CarouselRow>
          </section>
        )}

        {/* Trending Section */}
        <section className={styles.trendingSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>🔥</span>
              Trending Now
            </h2>
          </div>
          <CarouselRow>
            {trending.map((movie) => (
              <div key={movie.id} className={styles.trendingCard} onClick={() => handleSelectMovie(movie)}>
                <Image width={780} height={439}
                  className={styles.trendingBackdrop}
                  src={getBackdropUrl(movie.backdrop_url || movie.poster_url)}
                  alt={movie.title}
                  loading="lazy"
                />
                <div className={styles.trendingPlatforms}>
                  {(movie.platforms || []).slice(0, 2).map((p, i) => (
                    <span key={i} className={styles.platformBadge}>{p.name}</span>
                  ))}
                </div>
                <div className={styles.trendingOverlay}>
                  <div className={styles.trendingTitle}>{movie.title}</div>
                  <div className={styles.trendingMeta}>
                    <span className={`rating-badge ${getRatingClass(movie.imdb_rating)}`}>
                      ⭐ {movie.imdb_rating?.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CarouselRow>
        </section>

        {/* Genre Rows */}
        {GENRE_CONFIG.map((genre) => {
          const movies = genreData[genre.slug] || [];
          if (movies.length === 0) return null;

          return (
            <section key={genre.slug} className={styles.genreSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>
                  <span className={styles.sectionIcon}>{genre.icon}</span>
                  {genre.name}
                </h2>
                <button className={styles.showMoreBtn}>Show More →</button>
              </div>
              <CarouselRow>
                {movies.map((movie) => (
                  <TitleCard
                    key={movie.id}
                    movie={movie}
                    onClick={() => handleSelectMovie(movie)}
                  />
                ))}
              </CarouselRow>
            </section>
          );
        })}

        {/* Coming Soon */}
        {comingSoon.length > 0 && (
          <section className={styles.genreSection}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.sectionIcon}>⏳</span>
                Coming Soon
              </h2>
            </div>
            <CarouselRow>
              {comingSoon.map((movie) => {
                const days = daysUntil(movie.coming_date);
                return (
                  <div key={movie.id} className={styles.specialCard}>
                    <TitleCard movie={movie} onClick={() => handleSelectMovie(movie)} />
                    {days !== null && (
                      <div className={`${styles.countdownBadge} ${styles.countdownBadgeUpcoming}`}>
                        Available in {days}d
                      </div>
                    )}
                  </div>
                );
              })}
            </CarouselRow>
          </section>
        )}

        {/* Leaving Soon */}
        {leavingSoon.length > 0 && (
          <section className={styles.genreSection}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.sectionIcon}>⚠️</span>
                Leaving Soon
              </h2>
            </div>
            <CarouselRow>
              {leavingSoon.map((movie) => {
                const days = daysUntil(movie.leaving_date);
                return (
                  <div key={movie.id} className={styles.specialCard}>
                    <TitleCard movie={movie} onClick={() => handleSelectMovie(movie)} />
                    {days !== null && (
                      <div className={`${styles.countdownBadge} ${styles.countdownBadgeUrgent}`}>
                        Leaving in {days}d
                      </div>
                    )}
                  </div>
                );
              })}
            </CarouselRow>
          </section>
        )}
      </div>

      {/* Movie Detail Modal */}
      {selectedMovie && (
        <div className="modal-overlay" onClick={() => setSelectedMovie(null)}>
          <div className={`modal-content ${styles.movieModal}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalBackdropOverlay}>
              <Image width={780} height={439}
                className={styles.modalBackdrop}
                src={getBackdropUrl(selectedMovie.backdrop_url || selectedMovie.poster_url)}
                alt={selectedMovie.title}
              />
              <button className={styles.modalCloseBtn} onClick={() => setSelectedMovie(null)}>✕</button>
            </div>
            <div className={styles.modalInfo}>
              <h2 className={styles.modalTitle}>{selectedMovie.title}</h2>
              <div className={styles.modalMeta}>
                <span className={`rating-badge ${getRatingClass(selectedMovie.imdb_rating)}`}>
                  ⭐ {selectedMovie.imdb_rating?.toFixed(1)} IMDb
                </span>
                {selectedMovie.release_date && (
                  <span className="badge">{new Date(selectedMovie.release_date).getFullYear()}</span>
                )}
                <span className="badge">{selectedMovie.content_type === 'series' ? '📺 Series' : '🎬 Movie'}</span>
              </div>

              <div className={styles.modalGenreTags}>
                {(selectedMovie.genres || []).map((g, i) => (
                  <span key={i} className={styles.genreTag}>{typeof g === 'string' ? g : g.name || g}</span>
                ))}
              </div>

              {selectedMovie.overview && (
                <p className={styles.modalOverview}>{selectedMovie.overview}</p>
              )}

              <div className={styles.modalCrew}>
                {selectedMovie.director && (
                  <p>Director: <span>{selectedMovie.director}</span></p>
                )}
                {selectedMovie.cast_members && selectedMovie.cast_members.length > 0 && (
                  <p>Cast: <span>{(Array.isArray(selectedMovie.cast_members) ? selectedMovie.cast_members : []).join(', ')}</span></p>
                )}
              </div>

              {selectedMovie.platforms && selectedMovie.platforms.length > 0 && (
                <div className={styles.modalPlatforms}>
                  <h4>Available on</h4>
                  <div className={styles.platformPills}>
                    {selectedMovie.platforms.map((p, i) => (
                      <button key={i} className={styles.platformPill} onClick={() => handleRedirect(selectedMovie, p)}>
                        {PLATFORM_ICONS[p.name] || '📺'} {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  className={`btn btn-primary ${styles.watchBtn}`}
                  onClick={() => handleWatchClick(selectedMovie)}
                >
                  🎬 I&apos;m Going to Watch This
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => window.open(`/share/${selectedMovie.id}`, '_blank')}
                >
                  🔗 Share
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Platform Selection Modal */}
      {showPlatformModal && (
        <div className="modal-overlay" onClick={() => setShowPlatformModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <div className={styles.platformModal}>
                <h3>Choose Your Platform</h3>
                <p>This title is available on multiple platforms. Where would you like to watch?</p>
                <div className={styles.platformModalGrid}>
                  {showPlatformModal.platforms.map((p, i) => (
                    <div
                      key={i}
                      className={styles.platformModalCard}
                      onClick={() => handleRedirect(showPlatformModal, p)}
                    >
                      <div className={styles.platformModalIcon}>{PLATFORM_ICONS[p.name] || '📺'}</div>
                      <div className={styles.platformModalName}>{p.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="modal-overlay" onClick={() => setShowFeedback(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>How was it? 🍿</h3>
              <button className="modal-close" onClick={() => setShowFeedback(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className={styles.feedbackModal}>
                <div className={styles.feedbackMovieInfo}>
                  <div className={styles.feedbackPoster}>
                    <Image src={getImageUrl(showFeedback.poster_url)} alt={showFeedback.title} width={300} height={450} />
                  </div>
                  <div>
                    <h4>{showFeedback.title}</h4>
                    <span className="badge" style={{ marginTop: 4 }}>
                      ⭐ {showFeedback.imdb_rating?.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className={styles.feedbackQuestion}>
                  <label>1. Did you watch it?</label>
                  <div className={styles.watchToggle}>
                    <button
                      className={`${styles.watchToggleBtn} ${feedbackData.watched === false ? styles.watchToggleBtnActive : ''}`}
                      onClick={() => setFeedbackData(prev => ({ ...prev, watched: false }))}
                    >
                      👎 No
                    </button>
                    <button
                      className={`${styles.watchToggleBtn} ${feedbackData.watched === true ? styles.watchToggleBtnActive : ''}`}
                      onClick={() => setFeedbackData(prev => ({ ...prev, watched: true }))}
                    >
                      👍 Yes
                    </button>
                  </div>
                </div>

                {feedbackData.watched && (
                  <>
                    <div className={styles.feedbackQuestion}>
                      <label>2. Rate our recommendation (1-10)</label>
                      <div className={styles.starRating}>
                        {Array.from({ length: 10 }).map((_, i) => (
                          <span
                            key={i}
                            className={`${styles.star} ${i < feedbackData.rating ? styles.starActive : ''}`}
                            onClick={() => setFeedbackData(prev => ({ ...prev, rating: i + 1 }))}
                          >
                            ⭐
                          </span>
                        ))}
                      </div>
                      {feedbackData.rating > 0 && (
                        <div className={styles.ratingDisplay}>{feedbackData.rating} / 10</div>
                      )}
                    </div>

                    <div className={styles.feedbackQuestion}>
                      <label>3. What did you like? (Select all that apply)</label>
                      <div className={styles.aspectGrid}>
                        {['Plot', 'Direction', 'Acting', 'VFX', 'Music'].map((aspect) => (
                          <button
                            key={aspect}
                            className={`${styles.aspectChip} ${feedbackData.aspects.includes(aspect.toLowerCase()) ? styles.aspectChipActive : ''}`}
                            onClick={() => toggleAspect(aspect.toLowerCase())}
                          >
                            {aspect === 'Plot' && '📖 '}
                            {aspect === 'Direction' && '🎥 '}
                            {aspect === 'Acting' && '🎭 '}
                            {aspect === 'VFX' && '✨ '}
                            {aspect === 'Music' && '🎵 '}
                            {aspect}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowFeedback(null)}>
                Skip for now
              </button>
              <button
                className="btn btn-primary"
                disabled={feedbackData.watched === null || (feedbackData.watched === true && feedbackData.rating === 0)}
                onClick={handleFeedbackSubmit}
              >
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ============================================
// Sub-Components
// ============================================

function CarouselRow({ children }) {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 400;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={styles.carouselWrapper}>
      <button
        className={`${styles.carouselArrow} ${styles.carouselArrowLeft}`}
        onClick={() => scroll('left')}
        aria-label="Scroll left"
      >
        ‹
      </button>
      <div className={styles.carousel} ref={scrollRef}>
        {children}
      </div>
      <button
        className={`${styles.carouselArrow} ${styles.carouselArrowRight}`}
        onClick={() => scroll('right')}
        aria-label="Scroll right"
      >
        ›
      </button>
    </div>
  );
}

function TitleCard({ movie, onClick }) {
  return (
    <div className={styles.titleCard} onClick={onClick}>
      <div className={styles.posterImage}>
        <Image width={342} height={513}
          src={getImageUrl(movie.poster_url)}
          alt={movie.title}
          loading="lazy"
        />
        <div className={`${styles.posterRating} rating-badge ${getRatingClass(movie.imdb_rating)}`}>
          ⭐ {movie.imdb_rating?.toFixed(1) || 'N/A'}
        </div>
        <div className={styles.posterPlatforms}>
          {(movie.platforms || []).slice(0, 2).map((p, i) => (
            <div key={i} className={styles.posterPlatformDot} title={p.name}>
              {PLATFORM_ICONS[p.name] || '📺'}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.titleCardInfo}>
        <div className={styles.titleCardTitle}>{movie.title}</div>
        {movie.release_date && (
          <div className={styles.titleCardYear}>{new Date(movie.release_date).getFullYear()}</div>
        )}
      </div>
    </div>
  );
}
