import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
}

function formatScheduleTitle(schedule) {
  return `${schedule.studentName || '未命名学生'} · ${schedule.companyName || '未填写公司'}`;
}

function sortByStartTime(items) {
  return [...items].sort((left, right) => (left.startsAt || '').localeCompare(right.startsAt || ''));
}

export default function TeacherWorkspace({ user = {} }) {
  const teacherId = user.teacherId;
  const [schedules, setSchedules] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');

  async function loadTeacherData() {
    if (!teacherId) {
      setSchedules([]);
      setRequests([]);
      setLoading(false);
      setError('当前账号没有绑定老师身份，请联系管理员处理。');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [scheduleData, requestData] = await Promise.all([
        apiGet(`/api/schedules?teacherId=${encodeURIComponent(teacherId)}`),
        apiGet(`/api/schedules?teacherId=${encodeURIComponent(teacherId)}&status=requested`)
      ]);
      setSchedules(sortByStartTime(scheduleData.items || []));
      setRequests(sortByStartTime(requestData.items || []));
    } catch (err) {
      setError(err.message || '老师工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeacherData();
  }, [teacherId]);

  async function handleAction(schedule, action) {
    const actionPath = { accept: 'accept', cancel: 'cancel', complete: 'complete' }[action];
    if (!actionPath) return;

    setActingId(schedule.id);
    setError('');
    try {
      const body = action === 'accept' ? { confirmedByName: user.username || schedule.teacherName || '老师' } : {};
      await apiPost(`/api/schedules/${schedule.id}/${actionPath}`, body);
      await loadTeacherData();
    } catch (err) {
      setError(err.message || '操作失败，请稍后重试');
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="page teacher-workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">老师端</p>
          <h1>我的教务工作台</h1>
          <p className="muted">集中处理面试排期、学生申请和课后跟进事项。</p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="empty-state">正在加载老师工作台...</div>}

      {!loading && (
        <div className="workspace-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>待接收申请</h2>
              <span>{requests.length} 条</span>
            </div>
            {!requests.length && <div className="empty-state">暂无学生排期申请。</div>}
            <div className="record-list">
              {requests.map((schedule) => (
                <article className="record-item" key={schedule.id}>
                  <div>
                    <strong>{formatScheduleTitle(schedule)}</strong>
                    <p>{schedule.positionName || '未填写岗位'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                    {schedule.remark && <p className="muted">备注：{schedule.remark}</p>}
                  </div>
                  <div className="actions">
                    <button type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'accept')}>接收</button>
                    <button type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'cancel')}>取消</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>我的排期</h2>
              <span>{schedules.length} 条</span>
            </div>
            {!schedules.length && <div className="empty-state">暂无排期记录。</div>}
            <div className="record-list">
              {schedules.map((schedule) => (
                <article className="record-item" key={schedule.id}>
                  <div>
                    <strong>{formatScheduleTitle(schedule)}</strong>
                    <p>{schedule.positionName || '未填写岗位'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                    <StatusBadge status={schedule.status} />
                  </div>
                  <div className="actions">
                    {!['completed', 'cancelled'].includes(schedule.status) && (
                      <>
                        {schedule.status === 'requested' ? (
                          <button type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'accept')}>接收</button>
                        ) : (
                          <button type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'complete')}>完成</button>
                        )}
                        <button type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'cancel')}>取消</button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
