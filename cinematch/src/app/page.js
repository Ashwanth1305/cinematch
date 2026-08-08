'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import styles from './page.module.css';

const PLATFORMS = [
  'Netflix', 'Prime Video', 'JioHotstar',
  'Zee5', 'SonyLIV', 'Apple TV+', 'Lionsgate Play'
];

const FEATURES = [
  {
    icon: '🎯',
    title: 'One Place, All Platforms',
    description: 'Connect your Netflix, JioHotstar, Prime Video, and more. We show you content only from platforms you already pay for — no more switching between apps.'
  },
  {
    icon: '🧠',
    title: 'AI That Learns Your Taste',
    description: 'Our recommendation engine understands what you love — whether it\'s plot-driven thrillers or visually stunning sci-fi. The more you interact, the smarter it gets.'
  },
  {
    icon: '🎬',
    title: 'Genre-First Discovery',
    description: 'Browse by Action, Comedy, Horror, Thriller, Romance, and more. Each genre has its own curated carousel of the best titles available on your platforms.'
  },
  {
    icon: '⚡',
    title: 'Instant Watch Redirect',
    description: 'Found something you love? One tap takes you directly to the streaming app. If it\'s on multiple platforms, you choose where to watch.'
  }
];

const STEPS = [
  {
    title: 'Sign Up & Select Your Platforms',
    description: 'Create your account and tell us which OTT platforms you subscribe to. We support Netflix, Prime Video, JioHotstar, Zee5, SonyLIV, Apple TV+, and Lionsgate Play.'
  },
  {
    title: 'Pick 5 Movies You Loved',
    description: 'Help us understand your taste from the start. Choose 5 movies you\'ve already enjoyed — this seeds your personalized recommendations instantly.'
  },
  {
    title: 'Explore Your Personalized Feed',
    description: 'Browse trending titles, genre-organized carousels, and coming-soon content — all filtered to your platforms and ranked by what matches your taste.'
  },
  {
    title: 'Watch, Rate & Get Smarter Picks',
    description: 'After watching, tell us what you thought. Our AI uses your feedback to fine-tune recommendations — the more you share, the better they get.'
  }
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!loading && user?.onboarding_completed) {
      router.push('/home');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading CineMatch...</p>
      </div>
    );
  }

  return (
    <div className={styles.landing}>
      {/* Navigation */}
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>🎬</div>
          <span>Cine<span className="gradient-text">Match</span></span>
        </div>
        <div className={styles.navLinks}>
          <button className="btn btn-ghost" onClick={() => router.push('/auth/signin')}>
            Sign In
          </button>
          <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroGlow + ' ' + styles.heroGlow1} />
        <div className={styles.heroGlow2 + ' ' + styles.heroGlow} />

        <div className={styles.heroContent}>
          <div className={styles.heroTag}>
            <span>✨</span>
            <span>AI-Powered Movie Discovery</span>
          </div>

          <h1 className={styles.heroTitle}>
            Your Movies.{' '}
            <span className="gradient-text">Your Platforms.</span>{' '}
            One Perfect Feed.
          </h1>

          <p className={styles.heroSubtitle}>
            Stop scrolling through 5 different apps. CineMatch unifies your streaming subscriptions 
            and delivers personalized recommendations that actually match your taste — powered by AI 
            that learns from every interaction.
          </p>

          <div className={styles.heroCta}>
            <button className="btn btn-primary btn-lg" onClick={() => router.push('/auth/signup')}>
              🚀 Start Discovering
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => {
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              How It Works
            </button>
          </div>

          <div className={styles.heroPlatforms}>
            {PLATFORMS.map((name) => (
              <div key={name} className={styles.platformPill}>
                <div className={styles.platformDot} />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features} id="features">
        <p className={styles.sectionLabel}>Why CineMatch</p>
        <h2 className={styles.sectionTitle}>
          Everything you need for <span className="gradient-text">smarter streaming</span>
        </h2>
        <div className={styles.featuresGrid}>
          {FEATURES.map((feature, i) => (
            <div key={i} className={styles.featureCard}>
              <div className={styles.featureIcon}>{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className={styles.howItWorks} id="how-it-works">
        <p className={styles.sectionLabel}>How It Works</p>
        <h2 className={styles.sectionTitle}>
          Up and running in <span className="gradient-text">4 simple steps</span>
        </h2>
        <div className={styles.steps}>
          {STEPS.map((step, i) => (
            <div key={i} className={styles.step}>
              <div className={styles.stepNumber}>
                {i + 1}
                {i < STEPS.length - 1 && <div className={styles.stepLine} />}
              </div>
              <div className={styles.stepContent}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className={styles.ctaSection}>
        <div className={styles.ctaCard}>
          <h2>Ready to find your next favorite?</h2>
          <p>Join CineMatch and never waste time scrolling through apps again. Your perfect movie is waiting.</p>
          <button className="btn btn-primary btn-lg" onClick={() => router.push('/auth/signup')}>
            🎬 Create Free Account
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>© 2025 CineMatch. Built with ❤️ for movie lovers.</p>
      </footer>
    </div>
  );
}
