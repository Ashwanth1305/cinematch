'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import styles from '../auth.module.css';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.onboarding_completed) {
        router.push('/home');
      } else {
        router.push('/onboarding/platforms');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <Link href="/" className={styles.authLogo}>
            <div className={styles.authLogoIcon}>🎬</div>
            <span>Cine<span className="gradient-text">Match</span></span>
          </Link>
          <h1>Welcome back</h1>
          <p>Sign in to continue to your personalized feed</p>
        </div>

        {error && <div className={styles.authError}>{error}</div>}

        <form className={styles.authForm} onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className={styles.passwordToggle}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing In...' : '🎬 Sign In'}
          </button>
        </form>

        <div className={styles.authDivider}>
          <span>or continue with</span>
        </div>

        <div className={styles.oauthButtons}>
          <button className={styles.oauthBtn} onClick={() => alert('Google OAuth requires API keys. Configure in .env.local')}>
            <span className={styles.oauthIcon}>🔵</span>
            Continue with Google
          </button>
          <button className={styles.oauthBtn} onClick={() => alert('Apple Sign-In requires API keys. Configure in .env.local')}>
            <span className={styles.oauthIcon}>🍎</span>
            Continue with Apple
          </button>
        </div>

        <div className={styles.authFooter}>
          Don&apos;t have an account? <Link href="/auth/signup">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
