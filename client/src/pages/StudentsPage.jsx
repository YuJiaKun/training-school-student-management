import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyForm = {
  name: '',
  phone: '',
  gender: '',
  birthday: '',
  className: '',
  enrolledAt: '',
  remark: ''
};

function buildPath(path, params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filters = useMemo(() => ({ keyword, status }), [keyword, status]);
  const exportUrl = buildPath('/api/export/students', filters);

  async function loadStudents() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet(buildPath('/api/students', filters));
      setStudents(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || '学生列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();
  }, [filters]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(student) {
    setEditingId(student.id);
    setForm({
      name: student.name || '',
      phone: student.phone || '',
      gender: student.gender || '',
      birthday: student.birthday || '',
      className: student.className || '',
      enrolledAt: student.enrolledAt || '',
      remark: student.remark || ''
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      if (editingId) {
        await apiPatch(`/api/students/${editingId}`, form);
      } else {
        await apiPost('/api/students', form);
      }
      resetForm();
      await loadStudents();
    } catch (err) {
      setError(err.message || '学生信息保存失败');
    }
  }

  async function archiveStudent(student) {
    setError('');
    try {
      await apiPost(`/api/students/${student.id}/archive`, {});
      await loadStudents();
    } catch (err) {
      setError(err.message || '归档学生失败');
    }
  }

  return (
    <section className="admin-page students-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">学员档案</p>
          <h1>学生管理</h1>
          <p className="page-description">维护学生基础资料，筛选在读或归档状态，并导出当前结果。</p>
        </div>
        <a className="button button-secondary" href={exportUrl}>导出 CSV</a>
      </div>

      <div className="toolbar">
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索姓名或手机号" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">在读</option>
          <option value="archived">已归档</option>
        </select>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? '编辑学生' : '新增学生'}</h2>
        <input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="姓名" />
        <input required value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="手机号" />
        <input value={form.gender} onChange={(event) => updateForm('gender', event.target.value)} placeholder="性别" />
        <input type="date" value={form.birthday} onChange={(event) => updateForm('birthday', event.target.value)} />
        <input value={form.className} onChange={(event) => updateForm('className', event.target.value)} placeholder="班级/课程" />
        <input type="date" value={form.enrolledAt} onChange={(event) => updateForm('enrolledAt', event.target.value)} />
        <textarea value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="备注" />
        <div className="form-actions">
          <button className="button button-primary" type="submit">{editingId ? '保存修改' : '新增学生'}</button>
          {editingId ? <button className="button button-secondary" type="button" onClick={resetForm}>取消编辑</button> : null}
        </div>
      </form>

      <div className="table-summary">{loading ? '正在加载学生...' : `共 ${total} 名学生`}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>班级/课程</th>
              <th>入学时间</th>
              <th>状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id}>
                <td>{student.name}</td>
                <td>{student.phone}</td>
                <td>{student.className || '-'}</td>
                <td>{student.enrolledAt || '-'}</td>
                <td><StatusBadge status={student.status} /></td>
                <td>{student.remark || '-'}</td>
                <td className="table-actions">
                  <button type="button" onClick={() => startEdit(student)}>编辑</button>
                  {student.status !== 'archived' ? <button type="button" onClick={() => archiveStudent(student)}>归档</button> : null}
                </td>
              </tr>
            ))}
            {!students.length && !loading ? (
              <tr>
                <td colSpan="7" className="empty-cell">暂无学生数据</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
