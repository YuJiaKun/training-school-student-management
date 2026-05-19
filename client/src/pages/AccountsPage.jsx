import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyTeacherForm = {
  username: '',
  teacherName: '',
  classNames: '',
  participatesInScheduling: false
};

function parseClassNames(value) {
  return String(value || '')
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatClassNames(items) {
  return Array.isArray(items) ? items.join('、') : '';
}

export default function AccountsPage() {
  const [teacherAccounts, setTeacherAccounts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(emptyTeacherForm);
  const [editing, setEditing] = useState({});
  const [createdAccount, setCreatedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const classHint = useMemo(() => {
    const names = classes.map((item) => item.className).filter(Boolean);
    return names.length ? names.join('、') : '暂无班级，可先在学生管理或作业发布页新增';
  }, [classes]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [teacherData, classData] = await Promise.all([
        apiGet('/api/admin/teacher-accounts'),
        apiGet('/api/classes')
      ]);
      setTeacherAccounts(teacherData.items || []);
      setClasses(classData.items || []);
    } catch (err) {
      setError(err.message || '账号数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEditing(accountKey, field, value) {
    setEditing((current) => ({
      ...current,
      [accountKey]: {
        ...current[accountKey],
        [field]: value
      }
    }));
  }

  function editableAccount(account) {
    const current = editing[account.accountKey] || {};
    return {
      teacherName: current.teacherName ?? account.teacherName ?? account.name ?? '',
      classNames: current.classNames ?? formatClassNames(account.classNames),
      participatesInScheduling: current.participatesInScheduling ?? account.participatesInScheduling === true
    };
  }

  async function createTeacherAccount(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    setCreatedAccount(null);
    try {
      const result = await apiPost('/api/admin/teacher-accounts', {
        username: form.username.trim(),
        teacherName: form.teacherName.trim(),
        classNames: parseClassNames(form.classNames),
        participatesInScheduling: form.participatesInScheduling
      });
      setCreatedAccount(result.account || null);
      setForm(emptyTeacherForm);
      setMessage('已新增老师账号，请及时保存初始密码。');
      await loadData();
    } catch (err) {
      setError(err.message || '新增老师账号失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveTeacherAccount(account) {
    const current = editableAccount(account);
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPatch(`/api/admin/teacher-accounts/${encodeURIComponent(account.accountKey)}`, {
        teacherName: current.teacherName.trim(),
        classNames: parseClassNames(current.classNames),
        participatesInScheduling: current.participatesInScheduling
      });
      setMessage(`已更新 ${result.account?.teacherName || account.username}`);
      setEditing((state) => {
        const next = { ...state };
        delete next[account.accountKey];
        return next;
      });
      await loadData();
    } catch (err) {
      setError(err.message || '更新老师账号失败');
    } finally {
      setSaving(false);
    }
  }

  async function disableTeacherAccount(account) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await apiDelete(`/api/admin/teacher-accounts/${encodeURIComponent(account.accountKey)}`);
      setMessage(`已停用 ${account.teacherName || account.username}`);
      await loadData();
    } catch (err) {
      setError(err.message || '停用老师账号失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-page accounts-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">账号与权限</p>
          <h1>账号管理</h1>
          <p className="page-description">新增、维护和停用老师账号；学生账号停用请在学生管理搜索到学生后操作。</p>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}

      <form className="panel form-grid" onSubmit={createTeacherAccount}>
        <h2>新增老师账号</h2>
        <p className="form-hint form-wide">默认不参与学生面试排期；老师也可以登录后在自己的教务工作台自行开启。</p>
        <label>
          登录账号
          <input required value={form.username} onChange={(event) => updateForm('username', event.target.value)} placeholder="例如 teacher02" />
        </label>
        <label>
          老师姓名
          <input required value={form.teacherName} onChange={(event) => updateForm('teacherName', event.target.value)} placeholder="例如 李老师" />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.participatesInScheduling}
            onChange={(event) => updateForm('participatesInScheduling', event.target.checked)}
          />
          允许学生预约面试排期
        </label>
        <label className="form-wide">
          负责班级/课程
          <textarea value={form.classNames} onChange={(event) => updateForm('classNames', event.target.value)} placeholder="多个班级用逗号或换行分隔，可留空" />
        </label>
        <p className="form-hint form-wide">当前可用班级：{classHint}</p>
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? '正在保存...' : '新增老师账号'}
          </button>
        </div>
        {createdAccount ? (
          <div className="account-preview form-wide">
            <strong>{createdAccount.teacherName} 的初始密码</strong>
            <span>{createdAccount.username} / {createdAccount.initialPassword}</span>
          </div>
        ) : null}
      </form>

      <section className="panel">
        <div className="panel-header">
          <h2>老师账号</h2>
          <span>{loading ? '加载中...' : `${teacherAccounts.length} 个`}</span>
        </div>
        {!loading && !teacherAccounts.length ? <div className="empty-state">暂无老师账号。</div> : null}
        <div className="account-list">
          {teacherAccounts.map((account) => {
            const current = editableAccount(account);
            return (
              <article className="account-row" key={account.accountKey || account.username}>
                <div className="account-row-main">
                  <strong>{account.username}</strong>
                  <span>{account.teacherName || account.name || '-'}</span>
                  <StatusBadge status={account.status === 'disabled' ? 'cancelled' : 'confirmed'} />
                </div>
                <label>
                  老师姓名
                  <input value={current.teacherName} onChange={(event) => updateEditing(account.accountKey, 'teacherName', event.target.value)} />
                </label>
                <label>
                  负责班级/课程
                  <input value={current.classNames} onChange={(event) => updateEditing(account.accountKey, 'classNames', event.target.value)} placeholder="多个班级用逗号分隔" />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={current.participatesInScheduling}
                    onChange={(event) => updateEditing(account.accountKey, 'participatesInScheduling', event.target.checked)}
                  />
                  参与面试排期
                </label>
                <div className="actions">
                  <button className="button button-secondary" type="button" disabled={saving || account.status === 'disabled'} onClick={() => saveTeacherAccount(account)}>
                    保存
                  </button>
                  <button className="button danger-button" type="button" disabled={saving || account.status === 'disabled'} onClick={() => disableTeacherAccount(account)}>
                    停用
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
