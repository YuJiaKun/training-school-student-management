import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

function formatDateTime(value) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16);
}

export default function AdminScheduleQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');

  async function loadRequests() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/api/schedules?status=requested');
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || '排期申请加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  async function handleAction(schedule, action) {
    setActingId(schedule.id);
    setError('');
    try {
      const path = action === 'approve' ? 'approve' : 'reject';
      await apiPost(`/api/schedules/${schedule.id}/${path}`, { approverName: '管理员' });
      await loadRequests();
    } catch (err) {
      setError(err.message || '排期处理失败');
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="admin-page schedule-queue-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">排期处理</p>
          <h1>排期审批</h1>
          <p className="page-description">处理学生发起的面试排期申请，审批通过后进入周排期总览。</p>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="table-summary">{loading ? '正在加载申请...' : `待处理 ${items.length} 条`}</div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>学生</th>
              <th>老师</th>
              <th>公司</th>
              <th>岗位</th>
              <th>时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((schedule) => (
              <tr key={schedule.id}>
                <td>{schedule.studentName || '-'}</td>
                <td>{schedule.teacherName || '-'}</td>
                <td>{schedule.companyName || '-'}</td>
                <td>{schedule.positionName || '-'}</td>
                <td>{formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</td>
                <td><StatusBadge status={schedule.status} /></td>
                <td className="table-actions">
                  <button disabled={actingId === schedule.id} type="button" onClick={() => handleAction(schedule, 'approve')}>通过</button>
                  <button disabled={actingId === schedule.id} type="button" onClick={() => handleAction(schedule, 'reject')}>拒绝</button>
                </td>
              </tr>
            ))}
            {!items.length && !loading ? (
              <tr>
                <td colSpan="7" className="empty-cell">暂无待处理申请</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
