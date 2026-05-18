import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../api.js';
import InterviewScheduleCalendar, {
  scheduleToCalendarEvent,
  toLocalDateTimeValue
} from '../components/InterviewScheduleCalendar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const ACTIVE_CALENDAR_STATUSES = new Set(['requested', 'scheduled', 'confirmed', 'rescheduled', 'completed']);

function formatDateTime(value) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16);
}

function readRange(rangeInfo) {
  return {
    from: toLocalDateTimeValue(rangeInfo.start),
    to: toLocalDateTimeValue(rangeInfo.end)
  };
}

export default function SchedulesPage({ user = {} }) {
  const isAdmin = user.role === 'admin';
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState(isAdmin ? '' : String(user.teacherId || ''));
  const [range, setRange] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingMove, setSavingMove] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isAdmin) setSelectedTeacherId(String(user.teacherId || ''));
  }, [isAdmin, user.teacherId]);

  useEffect(() => {
    let ignore = false;
    apiGet('/api/teachers')
      .then((data) => {
        if (!ignore) setTeachers(data.items || []);
      })
      .catch((err) => {
        if (!ignore) setError(err.message || '老师列表加载失败');
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function loadSchedules(nextRange = range, nextTeacherId = selectedTeacherId) {
    if (!nextRange) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiGet(buildPath('/api/schedules', {
        from: nextRange.from,
        to: nextRange.to,
        teacherId: nextTeacherId || ''
      }));
      setSchedules((data.items || []).filter((schedule) => ACTIVE_CALENDAR_STATUSES.has(schedule.status)));
    } catch (err) {
      setSchedules([]);
      setError(err.message || '排期日历加载失败');
    } finally {
      setLoading(false);
    }
  }

  function handleDatesSet(rangeInfo) {
    const nextRange = readRange(rangeInfo);
    setRange(nextRange);
    loadSchedules(nextRange);
  }

  async function handleEventMove(info) {
    if (!isAdmin) {
      info.revert();
      return;
    }

    setSavingMove(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPatch(`/api/schedules/${info.event.id}`, {
        startsAt: toLocalDateTimeValue(info.event.start),
        endsAt: toLocalDateTimeValue(info.event.end)
      });
      setSelectedSchedule(result.schedule);
      setMessage('排期时间已更新。');
      await loadSchedules();
    } catch (err) {
      info.revert();
      setError(err.message || '排期时间更新失败，已恢复原时间。');
    } finally {
      setSavingMove(false);
    }
  }

  const events = useMemo(() => schedules.map((schedule) => scheduleToCalendarEvent(schedule, { editable: isAdmin })), [isAdmin, schedules]);
  const filteredTeacher = teachers.find((teacher) => String(teacher.id) === String(selectedTeacherId));

  return (
    <section className="page schedules-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">排期总览</p>
          <h1>{isAdmin ? '面试排期日历' : '我的面试排期'}</h1>
          <p className="muted">
            {isAdmin
              ? '按周或按日查看全部排期；拖动事件可调整时间，系统会自动校验冲突。'
              : '查看自己的待审批和已确认排期，审批操作仍在“我的教务工作台”处理。'}
          </p>
        </div>
        <div className="toolbar schedule-calendar-toolbar">
          {isAdmin ? (
            <select
              value={selectedTeacherId}
              onChange={(event) => {
                const nextTeacherId = event.target.value;
                setSelectedTeacherId(nextTeacherId);
                loadSchedules(range, nextTeacherId);
              }}
            >
              <option value="">全部老师</option>
              {teachers.map((teacher) => (
                <option value={teacher.id} key={teacher.id}>{teacher.name || `老师 #${teacher.id}`}</option>
              ))}
            </select>
          ) : (
            <strong>{filteredTeacher?.name || user.teacherName || user.username || '当前老师'}</strong>
          )}
          <span className="muted">{loading ? '正在加载...' : `${schedules.length} 条排期`}</span>
          {savingMove ? <span className="muted">正在保存时间...</span> : null}
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}

      <section className="panel schedule-calendar-panel">
        <InterviewScheduleCalendar
          events={events}
          editable={isAdmin}
          onDatesSet={handleDatesSet}
          onEventClick={(info) => setSelectedSchedule(info.event.extendedProps.schedule)}
          onEventDrop={handleEventMove}
          onEventResize={handleEventMove}
        />
      </section>

      <section className="panel schedule-detail-card">
        <div className="panel-header">
          <div>
            <h2>排期详情</h2>
            <p className="muted">点击日历事件查看学生、公司、岗位和状态。</p>
          </div>
        </div>
        {!selectedSchedule ? (
          <div className="empty-state">暂未选择排期。</div>
        ) : (
          <div className="schedule-detail-grid">
            <strong>{selectedSchedule.studentName || '未命名学生'}</strong>
            <span>{selectedSchedule.teacherName || '未命名老师'}</span>
            <span>{selectedSchedule.companyName || '未填写公司'} / {selectedSchedule.positionName || '未填写岗位'}</span>
            <span>{formatDateTime(selectedSchedule.startsAt)} 至 {formatDateTime(selectedSchedule.endsAt)}</span>
            <StatusBadge status={selectedSchedule.status} />
          </div>
        )}
      </section>
    </section>
  );
}
