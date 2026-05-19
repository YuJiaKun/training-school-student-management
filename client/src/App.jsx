import { useEffect, useMemo, useState } from 'react';
import { AUTH_EXPIRED_EVENT, LOGIN_EXPIRED_TEXT, api, toDisplayError } from './api.js';
import AppShell, { ROLE_TEXT } from './components/AppShell.jsx';

const IS_PRODUCTION = import.meta.env.PROD;

const DEMO_ACCOUNTS = IS_PRODUCTION ? [] : [
  { username: 'admin', password: 'admin123', role: '管理员', description: '总览学生、作业、面试和排期' },
  { username: 'teacher', password: 'teacher123', role: '老师', description: '接收排期并跟进学生面试' },
  { username: 'student', password: 'student123', role: '学生', description: '查看个人进度并申请排期' }
];

const EMPTY_LOGIN_FORM = {
  username: '',
  password: ''
};

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    api
      .get('/api/me')
      .then((payload) => {
        if (!active) return;
        setUser(payload.user);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus('guest');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      setUser(null);
      setStatus('guest');
      setError(LOGIN_EXPIRED_TEXT);
      window.location.hash = '';
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  async function handleLogin(credentials) {
    setError('');
    const payload = await api.post('/api/login', credentials);
    setUser(payload.user);
    setStatus('ready');
    window.location.hash = 'dashboard';
  }

  async function handleLogout() {
    setError('');
    try {
      await api.post('/api/logout');
    } catch (logoutError) {
      setError(toDisplayError(logoutError.message));
    } finally {
      setUser(null);
      setStatus('guest');
      window.location.hash = '';
    }
  }

  if (status === 'loading') {
    return (
      <div className="boot-screen">
        <div className="spinner" aria-hidden="true" />
        <p>正在加载教务工作台...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={handleLogin} initialError={error} />;
  }

  return <AppShell user={user} onLogout={handleLogout} />;
}

function LoginView({ onLogin, initialError }) {
  const [form, setForm] = useState(EMPTY_LOGIN_FORM);
  const [error, setError] = useState(initialError || '');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const errorId = 'login-form-error';
  const describedBy = error ? errorId : undefined;

  useEffect(() => {
    setError(initialError || '');
  }, [initialError]);

  const selectedDemoUsername = useMemo(() => {
    if (IS_PRODUCTION) return '';
    const selected = DEMO_ACCOUNTS.find(
      (account) => account.username === form.username && account.password === form.password
    );
    return selected?.username || '';
  }, [form.password, form.username]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  }

  function applyDemoAccount(account) {
    setForm({ username: account.username, password: account.password });
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const credentials = {
      username: form.username.trim(),
      password: form.password.trim()
    };

    setForm(credentials);

    if (!credentials.username && !credentials.password) {
      setError('请输入账号和密码');
      return;
    }

    if (!credentials.username) {
      setError('请输入账号');
      return;
    }

    if (!credentials.password) {
      setError('请输入密码');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await onLogin(credentials);
    } catch (loginError) {
      setError(toDisplayError(loginError.message));
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="登录">
        <div className="login-copy">
          <p className="eyebrow">教务 CRM</p>
          <h1>培训机构学生管理系统</h1>
          <p>统一管理学生档案、作业进度、面试记录和教务排期，让日常跟进更清楚、更稳当。</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="login-username">
            <span>账号</span>
            <input
              id="login-username"
              autoComplete="username"
              value={form.username}
              onChange={(event) => updateForm('username', event.target.value)}
              placeholder="请输入账号"
              disabled={submitting}
              aria-invalid={Boolean(error && !form.username.trim())}
              aria-describedby={describedBy}
              autoFocus
            />
          </label>
          <label htmlFor="login-password">
            <span>密码</span>
            <div className="password-field">
              <input
                id="login-password"
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => updateForm('password', event.target.value)}
                placeholder="请输入密码"
                disabled={submitting}
                aria-invalid={Boolean(error && !form.password.trim())}
                aria-describedby={describedBy}
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                disabled={submitting}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          {error ? (
            <p className="form-error" id={errorId} role="alert" aria-live="assertive">
              {error}
            </p>
          ) : (
            <p className="form-hint" aria-live="polite">
              请输入管理员、老师或学生账号进入对应工作台。
            </p>
          )}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在登录...' : '登录工作台'}
          </button>
        </form>

        {!IS_PRODUCTION && (
          <div className="demo-accounts" aria-label="演示身份">
            {DEMO_ACCOUNTS.map((account) => {
              const selected = selectedDemoUsername === account.username;
              return (
                <button
                  key={account.username}
                  className={selected ? 'demo-account is-selected' : 'demo-account'}
                  type="button"
                  onClick={() => applyDemoAccount(account)}
                  disabled={submitting}
                  aria-pressed={selected}
                >
                  <strong>{account.role}</strong>
                  <span>{account.username} / {account.password}</span>
                  <small>{account.description}</small>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="login-side" aria-label="系统概览">
        <div className="metric-row">
          <span>登录身份</span>
          <strong>{ROLE_TEXT[form.username.trim()] || '待选择'}</strong>
        </div>
        <div className="metric-row">
          <span>数据范围</span>
          <strong>学生 / 作业 / 面试 / 排期</strong>
        </div>
        <div className="metric-row">
          <span>部署方式</span>
          <strong>Node 单服务</strong>
        </div>
      </aside>
    </main>
  );
}
