import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyForm = {
  studentId: '',
  homeworkName: '',
  className: '',
  submitStatus: 'pending',
  submitAt: '',
  reviewResult: '',
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

export default function HomeworkPage() {
  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState([]);
  const [submitStatus, setSubmitStatus] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filters = useMemo(() => ({ submitStatus }), [submitStatus]);
  const exportUrl = buildPath('/api/export/homework', filters);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [recordData, studentData] = await Promise.all([
        apiGet(buildPath('/api/homework', filters)),
        apiGet('/api/students?pageSize=1000')
      ]);
      setRecords(recordData.items || []);
      setStudents(studentData.items || []);
    } catch (err) {
      setError(err.message || '作业数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [filters]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      await apiPost('/api/homework', { ...form, studentId: Number(form.studentId) });
      setForm(emptyForm);
      await loadData();
    } catch (err) {
      setError(err.message || '作业记录保存失败');
    }
  }

  async function updateRecord(record, patch) {
    setError('');
    try {
      await apiPatch(`/api/homework/${record.id}`, patch);
      await loadData();
    } catch (err) {
      setError(err.message || '作业状态更新失败');
    }
  }

  return (
    <section className="admin-page homework-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">教学跟进</p>
          <h1>作业管理</h1>
          <p className="page-description">记录作业提交状态、提交时间和批改结果，帮助老师跟进待处理学生。</p>
        </div>
        <a className="button button-secondary" href={exportUrl}>导出 CSV</a>
      </div>

      <div className="toolbar">
        <select value={submitStatus} onChange={(event) => setSubmitStatus(event.target.value)}>
          <option value="">全部提交状态</option>
          <option value="pending">待提交</option>
          <option value="submitted">已提交</option>
          <option value="reviewed">已批改</option>
        </select>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>新增作业记录</h2>
        <select required value={form.studentId} onChange={(event) => updateForm('studentId', event.target.value)}>
          <option value="">选择学生</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.name} · {student.className || '未分班'}</option>
          ))}
        </select>
        <input required value={form.homeworkName} onChange={(event) => updateForm('homeworkName', event.target.value)} placeholder="作业名称" />
        <input value={form.className} onChange={(event) => updateForm('className', event.target.value)} placeholder="班级/课程" />
        <select value={form.submitStatus} onChange={(event) => updateForm('submitStatus', event.target.value)}>
          <option value="pending">待提交</option>
          <option value="submitted">已提交</option>
          <option value="reviewed">已批改</option>
        </select>
        <input type="date" value={form.submitAt} onChange={(event) => updateForm('submitAt', event.target.value)} />
        <input value={form.reviewResult} onChange={(event) => updateForm('reviewResult', event.target.value)} placeholder="批改结果" />
        <textarea value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="备注" />
        <div className="form-actions">
          <button className="button button-primary" type="submit">新增作业记录</button>
        </div>
      </form>

      <div className="table-summary">{loading ? '正在加载作业...' : `共 ${records.length} 条作业记录`}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>作业名称</th>
              <th>学生 ID</th>
              <th>班级/课程</th>
              <th>提交状态</th>
              <th>提交时间</th>
              <th>批改结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.homeworkName || '-'}</td>
                <td>{record.studentId}</td>
                <td>{record.className || '-'}</td>
                <td><StatusBadge status={record.submitStatus} /></td>
                <td>{record.submitAt || '-'}</td>
                <td>{record.reviewResult ? <StatusBadge status={record.reviewResult} /> : '-'}</td>
                <td className="table-actions">
                  <button type="button" onClick={() => updateRecord(record, { submitStatus: 'submitted', submitAt: new Date().toISOString().slice(0, 10) })}>标记提交</button>
                  <button type="button" onClick={() => updateRecord(record, { submitStatus: 'reviewed', reviewResult: record.reviewResult || '已批改' })}>标记批改</button>
                </td>
              </tr>
            ))}
            {!records.length && !loading ? (
              <tr>
                <td colSpan="7" className="empty-cell">暂无作业记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
