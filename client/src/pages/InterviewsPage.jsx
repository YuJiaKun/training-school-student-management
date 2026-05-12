import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyForm = {
  studentId: '',
  companyName: '',
  positionName: '',
  interviewAt: '',
  result: 'pending',
  feedback: '',
  hiredStatus: 'pending',
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

export default function InterviewsPage() {
  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState([]);
  const [result, setResult] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filters = useMemo(() => ({ result }), [result]);
  const exportUrl = buildPath('/api/export/interviews', filters);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [recordData, studentData] = await Promise.all([
        apiGet(buildPath('/api/interviews', filters)),
        apiGet('/api/students?pageSize=1000')
      ]);
      setRecords(recordData.items || []);
      setStudents(studentData.items || []);
    } catch (err) {
      setError(err.message || '面试记录加载失败');
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
      await apiPost('/api/interviews', { ...form, studentId: Number(form.studentId) });
      setForm(emptyForm);
      await loadData();
    } catch (err) {
      setError(err.message || '面试记录保存失败');
    }
  }

  async function updateRecord(record, patch) {
    setError('');
    try {
      await apiPatch(`/api/interviews/${record.id}`, patch);
      await loadData();
    } catch (err) {
      setError(err.message || '面试记录更新失败');
    }
  }

  return (
    <section className="admin-page interviews-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">就业跟踪</p>
          <h1>面试记录</h1>
          <p className="page-description">沉淀公司、岗位、反馈和入职结果，形成可追踪的就业过程数据。</p>
        </div>
        <a className="button button-secondary" href={exportUrl}>导出 CSV</a>
      </div>

      <div className="toolbar">
        <select value={result} onChange={(event) => setResult(event.target.value)}>
          <option value="">全部面试结果</option>
          <option value="pending">待反馈</option>
          <option value="passed">通过</option>
          <option value="failed">未通过</option>
        </select>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>新增面试记录</h2>
        <select required value={form.studentId} onChange={(event) => updateForm('studentId', event.target.value)}>
          <option value="">选择学生</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.name} · {student.className || '未分班'}</option>
          ))}
        </select>
        <input required value={form.companyName} onChange={(event) => updateForm('companyName', event.target.value)} placeholder="公司名称" />
        <input value={form.positionName} onChange={(event) => updateForm('positionName', event.target.value)} placeholder="面试岗位" />
        <input type="datetime-local" value={form.interviewAt} onChange={(event) => updateForm('interviewAt', event.target.value)} />
        <select value={form.result} onChange={(event) => updateForm('result', event.target.value)}>
          <option value="pending">待反馈</option>
          <option value="passed">通过</option>
          <option value="failed">未通过</option>
        </select>
        <select value={form.hiredStatus} onChange={(event) => updateForm('hiredStatus', event.target.value)}>
          <option value="pending">待确认入职</option>
          <option value="hired">已入职</option>
          <option value="not_hired">未入职</option>
        </select>
        <textarea value={form.feedback} onChange={(event) => updateForm('feedback', event.target.value)} placeholder="面试反馈" />
        <div className="form-actions">
          <button className="button button-primary" type="submit">新增面试记录</button>
        </div>
      </form>

      <div className="table-summary">{loading ? '正在加载面试...' : `共 ${records.length} 条面试记录`}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>公司</th>
              <th>岗位</th>
              <th>学生 ID</th>
              <th>面试时间</th>
              <th>结果</th>
              <th>入职状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.companyName || '-'}</td>
                <td>{record.positionName || '-'}</td>
                <td>{record.studentId}</td>
                <td>{record.interviewAt ? record.interviewAt.replace('T', ' ').slice(0, 16) : '-'}</td>
                <td><StatusBadge status={record.result} /></td>
                <td><StatusBadge status={record.hiredStatus} /></td>
                <td className="table-actions">
                  <button type="button" onClick={() => updateRecord(record, { result: 'passed' })}>通过</button>
                  <button type="button" onClick={() => updateRecord(record, { result: 'failed' })}>未通过</button>
                  <button type="button" onClick={() => updateRecord(record, { hiredStatus: 'hired' })}>已入职</button>
                </td>
              </tr>
            ))}
            {!records.length && !loading ? (
              <tr>
                <td colSpan="7" className="empty-cell">暂无面试记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
