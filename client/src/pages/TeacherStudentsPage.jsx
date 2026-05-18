import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const LEARNING_STAGE_OPTIONS = [
  { value: 'studying', label: '学习中' },
  { value: 'job_seeking', label: '求职中' },
  { value: 'employed', label: '已就业' }
];

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadCsv(fileName, rows) {
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadStudentAccounts(accounts, fileName = '本次学生账号清单.csv') {
  const rows = [
    ['学生姓名', '班级/课程', '手机号', '用户名', '新初始密码'],
    ...accounts.map((account) => [
      account.studentName || `学生 #${account.studentId}`,
      account.className || '',
      account.studentPhone || '',
      account.username || '',
      account.initialPassword || ''
    ])
  ];
  downloadCsv(fileName, rows);
}

export default function TeacherStudentsPage() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [className, setClassName] = useState('');
  const [learningStage, setLearningStage] = useState('');
  const [keyword, setKeyword] = useState('');
  const [bulkClassName, setBulkClassName] = useState('');
  const [bulkLearningStage, setBulkLearningStage] = useState('job_seeking');
  const [deleteClassId, setDeleteClassId] = useState('');
  const [resetClassName, setResetClassName] = useState('');
  const [recentAccounts, setRecentAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [deletingClass, setDeletingClass] = useState(false);
  const [resettingAccounts, setResettingAccounts] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const filters = useMemo(() => ({ className, learningStage, keyword }), [className, keyword, learningStage]);
  const deletableClassOptions = useMemo(() => classes.filter((item) => item.id !== undefined && item.id !== null), [classes]);

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const [classPayload, studentPayload] = await Promise.all([
        apiGet('/api/classes'),
        apiGet(buildPath('/api/students', nextFilters))
      ]);
      const classItems = Array.isArray(classPayload?.items) ? classPayload.items : [];
      setClasses(classItems);
      setStudents(Array.isArray(studentPayload?.items) ? studentPayload.items : []);
    } catch (err) {
      setClasses([]);
      setStudents([]);
      setError(err.message || '班级学生加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSearch(event) {
    event.preventDefault();
    setMessage('');
    await loadData(filters);
  }

  async function handleRemoveStudent(student) {
    const confirmed = window.confirm(`确认将「${student.name}」移出当前班级并停用学生账号吗？历史作业、面试和排期记录会保留。`);
    if (!confirmed) return;

    setActingId(student.id);
    setError('');
    setMessage('');
    try {
      const result = await apiPost(`/api/teacher/students/${student.id}/remove-from-class`);
      setMessage(result.accountDisabled ? '已移出班级并停用学生账号。' : '已移出班级；该学生暂无绑定账号。');
      await loadData(filters);
    } catch (err) {
      setError(err.message || '移出学生失败');
    } finally {
      setActingId(null);
    }
  }

  async function updateTeacherStudent(student, patch) {
    setActingId(student.id);
    setError('');
    setMessage('');
    try {
      const result = await apiPatch(`/api/teacher/students/${student.id}`, patch);
      setMessage(`已更新「${result.student?.name || student.name}」。`);
      await loadData(filters);
    } catch (err) {
      setError(err.message || '更新学生失败');
    } finally {
      setActingId(null);
    }
  }

  async function handleBulkLearningStage() {
    if (!bulkClassName) {
      setError('请先选择要批量修改的班级/课程');
      return;
    }

    setBulkUpdating(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPost('/api/students/bulk-learning-stage', {
        className: bulkClassName,
        learningStage: bulkLearningStage
      });
      setMessage(`已将「${bulkClassName}」的 ${result.updatedCount || 0} 名在读学生切换为${statusText(bulkLearningStage)}。`);
      await loadData(filters);
    } catch (err) {
      setError(err.message || '批量修改学习阶段失败');
    } finally {
      setBulkUpdating(false);
    }
  }

  async function handleDeleteClass() {
    const classItem = deletableClassOptions.find((item) => String(item.id) === String(deleteClassId));
    if (!classItem) {
      setError('请先选择要删除的空班级');
      return;
    }

    const confirmed = window.confirm(`确认删除空班级「${classItem.className}」吗？仅删除班级枚举，不删除历史记录。`);
    if (!confirmed) return;

    setDeletingClass(true);
    setError('');
    setMessage('');
    try {
      await apiDelete(`/api/classes/${classItem.id}`);
      setMessage(`已删除空班级：${classItem.className}`);
      setDeleteClassId('');
      if (className === classItem.className) setClassName('');
      if (bulkClassName === classItem.className) setBulkClassName('');
      if (resetClassName === classItem.className) setResetClassName('');
      await loadData({ className: className === classItem.className ? '' : className, learningStage, keyword });
    } catch (err) {
      setError(err.message || '删除班级失败');
    } finally {
      setDeletingClass(false);
    }
  }

  async function handleResetClassAccounts() {
    if (!resetClassName) {
      setError('请先选择要重置密码的班级/课程');
      return;
    }

    const confirmed = window.confirm(`确认为「${resetClassName}」在读学生批量重置账号密码并导出清单吗？旧密码会立即失效。`);
    if (!confirmed) return;

    setResettingAccounts(true);
    setError('');
    setMessage('');
    setRecentAccounts([]);
    try {
      const result = await apiPost('/api/teacher/students/accounts/reset', { className: resetClassName });
      const accounts = result.accounts || [];
      setRecentAccounts(accounts);
      setMessage(`已重置 ${accounts.length} 个学生账号密码，跳过 ${result.skippedCount || 0} 名未生成账号学生。`);
      if (accounts.length) downloadStudentAccounts(accounts, `${resetClassName}-本次学生账号清单.csv`);
      await loadData(filters);
    } catch (err) {
      setError(err.message || '批量重置学生账号密码失败');
    } finally {
      setResettingAccounts(false);
    }
  }

  function resetFilters() {
    const nextFilters = { className: '', learningStage: '', keyword: '' };
    setClassName('');
    setLearningStage('');
    setKeyword('');
    setMessage('');
    loadData(nextFilters);
  }

  return (
    <section className="page teacher-students-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">老师端</p>
          <h1>班级学生</h1>
          <p className="muted">只展示你负责班级中的在读学生；移出学生会停用账号，但保留历史记录。</p>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}

      <form className="toolbar teacher-student-toolbar" onSubmit={handleSearch}>
        <select value={className} onChange={(event) => setClassName(event.target.value)}>
          <option value="">全部负责班级</option>
          {classes.map((item) => (
            <option key={item.className} value={item.className}>
              {item.className}（{item.studentCount || 0} 名在读）
            </option>
          ))}
        </select>
        <select value={learningStage} onChange={(event) => setLearningStage(event.target.value)}>
          <option value="">全部学习阶段</option>
          {LEARNING_STAGE_OPTIONS.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索姓名或手机号"
        />
        <button className="button button-primary" type="submit" disabled={loading}>搜索</button>
        <button className="button button-secondary" type="button" onClick={resetFilters} disabled={loading}>清空</button>
      </form>

      {loading ? <div className="empty-state">正在加载班级学生...</div> : null}

      {!loading && !classes.length ? (
        <div className="empty-state">当前账号暂未配置负责班级，请先在老师端新增班级或联系管理员配置。</div>
      ) : null}

      {!loading && classes.length > 0 ? (
        <>
          <section className="panel form-grid">
            <h2>整班学习阶段</h2>
            <p className="form-hint form-wide">只修改当前负责班级里的在读学生；已归档学生和历史记录不受影响。</p>
            <label>
              班级/课程
              <select value={bulkClassName} onChange={(event) => setBulkClassName(event.target.value)}>
                <option value="">请选择负责班级</option>
                {classes.map((item) => (
                  <option key={`bulk-${item.className}`} value={item.className}>
                    {item.className}（{item.studentCount || 0} 名在读）
                  </option>
                ))}
              </select>
            </label>
            <label>
              目标学习阶段
              <select value={bulkLearningStage} onChange={(event) => setBulkLearningStage(event.target.value)}>
                {LEARNING_STAGE_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={handleBulkLearningStage} disabled={bulkUpdating || !bulkClassName}>
                {bulkUpdating ? '正在修改...' : '批量修改学习阶段'}
              </button>
            </div>
          </section>

          <section className="panel form-grid">
            <h2>班级与账号维护</h2>
            <p className="form-hint form-wide">删除班级只允许操作空班级；导出密码采用“重置新初始密码后立即下载”，不会反查历史密码。</p>
            <label>
              删除空班级
              <select value={deleteClassId} onChange={(event) => setDeleteClassId(event.target.value)}>
                <option value="">请选择负责班级</option>
                {deletableClassOptions.map((item) => (
                  <option key={`delete-${item.id}`} value={item.id}>
                    {item.className}（{item.studentCount || 0} 名在读）
                  </option>
                ))}
              </select>
            </label>
            <label>
              重置密码班级
              <select value={resetClassName} onChange={(event) => setResetClassName(event.target.value)}>
                <option value="">请选择负责班级</option>
                {classes.map((item) => (
                  <option key={`reset-${item.className}`} value={item.className}>
                    {item.className}（{item.studentCount || 0} 名在读）
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions split-actions">
              <button className="danger-button" type="button" onClick={handleDeleteClass} disabled={deletingClass || !deleteClassId}>
                {deletingClass ? '正在删除...' : '删除空班级'}
              </button>
              <button className="button button-secondary" type="button" onClick={handleResetClassAccounts} disabled={resettingAccounts || !resetClassName}>
                {resettingAccounts ? '正在重置...' : '批量重置并导出账号清单'}
              </button>
              {recentAccounts.length ? (
                <button className="button button-secondary" type="button" onClick={() => downloadStudentAccounts(recentAccounts)}>
                  再次下载本次清单
                </button>
              ) : null}
            </div>
            {recentAccounts.length ? (
              <div className="account-preview form-wide">
                <div className="panel-header">
                  <div>
                    <h3>本次新初始密码</h3>
                    <p className="muted">共 {recentAccounts.length} 个账号；离开页面后不再展示明文密码。</p>
                  </div>
                </div>
                <div className="account-chip-list">
                  {recentAccounts.slice(0, 6).map((account) => (
                    <div className="account-chip" key={account.id || `${account.studentId}-${account.username}`}>
                      <strong>{account.studentName || `学生 #${account.studentId}`}</strong>
                      <span>{account.username} / {account.initialPassword || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <div className="table-wrap">
            <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>班级/课程</th>
                <th>学习阶段</th>
                <th>联系方式</th>
                <th>账号状态</th>
                <th>入学日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <strong>{student.name}</strong>
                    {student.remark ? <span className="cell-subtext">{student.remark}</span> : null}
                  </td>
                  <td>
                    <select
                      value={student.className || ''}
                      onChange={(event) => updateTeacherStudent(student, { className: event.target.value })}
                      disabled={actingId === student.id}
                    >
                      {classes.map((item) => (
                        <option key={`${student.id}-${item.className}`} value={item.className}>{item.className}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={student.learningStage || 'studying'}
                      onChange={(event) => updateTeacherStudent(student, { learningStage: event.target.value })}
                      disabled={actingId === student.id}
                    >
                      {LEARNING_STAGE_OPTIONS.map((option) => (
                        <option value={option.value} key={`${student.id}-${option.value}`}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>{student.phone || '未填写'}</td>
                  <td>
                    <StatusBadge status={student.hasAccount ? 'submitted' : undefined} tone={student.hasAccount ? undefined : 'muted'}>
                      {student.hasAccount ? '已生成' : '未生成'}
                    </StatusBadge>
                    {student.accountUsername ? <span className="cell-subtext">{student.accountUsername}</span> : null}
                  </td>
                  <td>{student.enrolledAt || '-'}</td>
                  <td className="table-actions">
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => handleRemoveStudent(student)}
                      disabled={actingId === student.id}
                    >
                      {actingId === student.id ? '处理中...' : '移出班级并停用账号'}
                    </button>
                  </td>
                </tr>
              ))}
              {!students.length ? (
                <tr>
                  <td colSpan="7" className="empty-cell">暂无符合条件的在读学生。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
