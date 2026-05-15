import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const CURRENT_STATUSES = new Set(['scheduled', 'confirmed', 'rescheduled']);
const HISTORY_STATUSES = new Set(['completed', 'cancelled']);

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
  const [requests, setRequests] = useState([]);
  const [currentSchedules, setCurrentSchedules] = useState([]);
  const [historySchedules, setHistorySchedules] = useState([]);
  const [participatesInScheduling, setParticipatesInScheduling] = useState(user.participatesInScheduling === true);
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [savingScheduling, setSavingScheduling] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const historyFilters = useMemo(() => ({
    teacherId,
    status: historyStatus,
    keyword: historyKeyword.trim(),
    from: historyFrom ? `${historyFrom}T00:00:00` : '',
    to: historyTo ? `${historyTo}T23:59:59` : ''
  }), [historyFrom, historyKeyword, historyStatus, teacherId]);

  async function loadTeacherData() {
    if (!teacherId) {
      setRequests([]);
      setCurrentSchedules([]);
      setHistorySchedules([]);
      setLoading(false);
      setError('当前账号没有绑定老师身份，请联系管理员处理。');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [allData, requestData, historyData] = await Promise.all([
        apiGet(`/api/schedules?teacherId=${encodeURIComponent(teacherId)}`),
        apiGet(`/api/schedules?teacherId=${encodeURIComponent(teacherId)}&status=requested`),
        apiGet(buildPath('/api/schedules', historyFilters))
      ]);
      const allSchedules = allData.items || [];
      const historyItems = (historyData.items || []).filter((schedule) =>
        historyStatus ? true : HISTORY_STATUSES.has(schedule.status)
      );
      setRequests(sortByStartTime(requestData.items || []));
      setCurrentSchedules(sortByStartTime(allSchedules.filter((schedule) => CURRENT_STATUSES.has(schedule.status))));
      setHistorySchedules(sortByStartTime(historyItems).reverse());
    } catch (err) {
      setError(err.message || '老师工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setParticipatesInScheduling(user.participatesInScheduling === true);
  }, [user.participatesInScheduling]);

  useEffect(() => {
    loadTeacherData();
  }, [teacherId, historyFilters]);

  async function handleSchedulingToggle(nextValue) {
    setSavingScheduling(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPatch('/api/teacher-workspace/scheduling', { participatesInScheduling: nextValue });
      setParticipatesInScheduling(result.teacher?.participatesInScheduling === true);
      setMessage(nextValue ? '已开启学生面试排期，学生端现在可以选择你。' : '已关闭学生面试排期，学生端将不再显示你。');
    } catch (err) {
      setError(err.message || '排期参与设置保存失败');
    } finally {
      setSavingScheduling(false);
    }
  }

  async function handleAction(schedule, action) {
    const actionPath = { approve: 'approve', reject: 'reject', cancel: 'cancel', complete: 'complete' }[action];
    if (!actionPath) return;

    setActingId(schedule.id);
    setError('');
    setMessage('');
    try {
      const body = action === 'approve'
        ? { confirmedByName: user.teacherName || user.username || schedule.teacherName || '老师' }
        : {};
      await apiPost(`/api/schedules/${schedule.id}/${actionPath}`, body);
      setMessage(action === 'approve' ? '已同意该面试申请。' : '排期状态已更新。');
      await loadTeacherData();
    } catch (err) {
      setError(err.message || '操作失败，请稍后重试');
    } finally {
      setActingId(null);
    }
  }

  function clearProcessedNotice() {
    setMessage('已处理的排期不会出现在“我的排期”里，可在历史排期中继续筛选查看。');
  }

  return (
    <section className="page teacher-workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">老师端</p>
          <h1>我的教务工作台</h1>
          <p className="muted">处理学生面试申请、查看当前排期，并在历史区筛选已完成或已取消记录。</p>
        </div>
        <label className="toggle-card">
          <span>参与学生面试排期</span>
          <input
            type="checkbox"
            checked={participatesInScheduling}
            disabled={!teacherId || savingScheduling}
            onChange={(event) => handleSchedulingToggle(event.target.checked)}
          />
        </label>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}
      {loading ? <div className="empty-state">正在加载老师工作台...</div> : null}

      {!loading ? (
        <>
          <div className="workspace-grid">
            <section className="panel">
              <div className="panel-header">
                <h2>待接收申请</h2>
                <span>{requests.length} 条</span>
              </div>
              {!requests.length ? <div className="empty-state">暂无学生排期申请。</div> : null}
              <div className="record-list">
                {requests.map((schedule) => (
                  <article className="record-item" key={schedule.id}>
                    <div>
                      <strong>{formatScheduleTitle(schedule)}</strong>
                      <p>{schedule.positionName || '未填写岗位'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                      {schedule.remark ? <p className="muted">备注：{schedule.remark}</p> : null}
                    </div>
                    <div className="actions">
                      <button className="button button-primary" type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'approve')}>同意</button>
                      <button className="button button-secondary" type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'reject')}>拒绝</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>我的排期</h2>
                <div className="actions">
                  <span>{currentSchedules.length} 条</span>
                  <button className="button button-secondary" type="button" onClick={clearProcessedNotice}>清空已处理提示</button>
                </div>
              </div>
              {!currentSchedules.length ? <div className="empty-state">暂无进行中或未来排期。</div> : null}
              <div className="record-list">
                {currentSchedules.map((schedule) => (
                  <article className="record-item" key={schedule.id}>
                    <div>
                      <strong>{formatScheduleTitle(schedule)}</strong>
                      <p>{schedule.positionName || '未填写岗位'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                      <StatusBadge status={schedule.status} />
                    </div>
                    <div className="actions">
                      <button className="button button-primary" type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'complete')}>完成</button>
                      <button className="button button-secondary" type="button" disabled={actingId === schedule.id} onClick={() => handleAction(schedule, 'cancel')}>取消</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="panel history-panel">
            <div className="panel-header">
              <h2>历史排期</h2>
              <span>{historySchedules.length} 条</span>
            </div>
            <div className="toolbar">
              <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
                <option value="">已完成/已取消</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已取消/已拒绝</option>
                <option value="confirmed">已确认</option>
                <option value="requested">待接收</option>
              </select>
              <input value={historyKeyword} onChange={(event) => setHistoryKeyword(event.target.value)} placeholder="搜索学生、公司、岗位" />
              <input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
              <input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
            </div>
            {!historySchedules.length ? <div className="empty-state">暂无符合条件的历史排期。</div> : null}
            <div className="record-list compact-list">
              {historySchedules.map((schedule) => (
                <article className="record-item" key={schedule.id}>
                  <div>
                    <strong>{formatScheduleTitle(schedule)}</strong>
                    <p>{schedule.positionName || '未填写岗位'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                  </div>
                  <StatusBadge status={schedule.status} />
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
