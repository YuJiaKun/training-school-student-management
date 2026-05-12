import { useEffect, useState } from 'react';
import { api, toDisplayError } from './api.js';
import AppShell, { ROLE_TEXT } from './components/AppShell.jsx';

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: '管理员' },
  { username: 'teacher', password: 'teacher123', role: '老师' },
  { username: 'student', password: 'student123', role: '学生' }
];

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
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' });
  const [error, setError] = useState(initialError || '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await onLogin(form);
    } catch (loginError) {
      setError(toDisplayError(loginError.message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="登录">
        <div className="login-copy">
          <p className="eyebrow">教务 CRM</p>
          <h1>培训机构学生管理系统</h1>
          <p>统一管理学生档案、作业进度、面试记录和教务排期，让日常跟进更清楚。</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>账号</span>
            <input
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="请输入账号"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="请输入密码"
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在登录...' : '登录工作台'}
          </button>
        </form>

        <div className="demo-accounts" aria-label="演示账号">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.username}
              type="button"
              onClick={() => setForm({ username: account.username, password: account.password })}
            >
              <strong>{account.role}</strong>
              <span>{account.username} / {account.password}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="login-side">
        <div className="metric-row">
          <span>学生状态</span>
          <strong>实时同步</strong>
        </div>
        <div className="metric-row">
          <span>当前角色</span>
          <strong>{ROLE_TEXT[form.username] || '待登录'}</strong>
        </div>
        <div className="metric-row">
          <span>部署方式</span>
          <strong>Node 单服务</strong>
        </div>
      </aside>
    </main>
  );
}
