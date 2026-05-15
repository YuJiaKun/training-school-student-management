import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

export default function TeacherStudentsPage() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [className, setClassName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const filters = useMemo(() => ({ className, keyword }), [className, keyword]);

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

  function resetFilters() {
    const nextFilters = { className: '', keyword: '' };
    setClassName('');
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>班级/课程</th>
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
                  <td>{student.className || '-'}</td>
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
                  <td colSpan="6" className="empty-cell">暂无符合条件的在读学生。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
