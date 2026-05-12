import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(input = new Date()) {
  const date = new Date(input);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return formatDate(date);
}

function moveWeek(weekStart, offset) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + offset * 7);
  return formatDate(date);
}

function buildWeekDates(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return formatDate(date);
  });
}

function formatTimeRange(schedule) {
  const start = schedule.startsAt?.slice(11, 16) || '--:--';
  const end = schedule.endsAt?.slice(11, 16) || '--:--';
  return `${start}-${end}`;
}

function groupEntriesByDate(entries) {
  return entries.reduce((result, entry) => {
    const date = entry.startsAt?.slice(0, 10);
    if (!date) return result;
    result[date] = result[date] || [];
    result[date].push(entry);
    return result;
  }, {});
}

export default function SchedulesPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [timeline, setTimeline] = useState({ weeks: [], teachers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    apiGet(`/api/schedules/timeline?weekStart=${encodeURIComponent(weekStart)}`)
      .then((data) => {
        if (!ignore) setTimeline({ weeks: data.weeks || [], teachers: data.teachers || [] });
      })
      .catch((err) => {
        if (!ignore) setError(err.message || '排期总览加载失败');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [weekStart]);

  const weekDays = timeline.weeks.length ? timeline.weeks : buildWeekDates(weekStart);
  const weekTitle = useMemo(() => `${weekDays[0]} 至 ${weekDays[6]}`, [weekDays]);

  return (
    <section className="page schedules-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">排期总览</p>
          <h1>一周面试排期</h1>
          <p className="muted">按老师维度查看本周已确认排期，方便快速发现时间占用。</p>
        </div>
        <div className="toolbar">
          <button type="button" onClick={() => setWeekStart(moveWeek(weekStart, -1))}>上一周</button>
          <strong>{weekTitle}</strong>
          <button type="button" onClick={() => setWeekStart(moveWeek(weekStart, 1))}>下一周</button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="empty-state">正在加载排期总览...</div>}

      {!loading && !timeline.teachers.length && (
        <div className="empty-state">本周暂无已确认排期。</div>
      )}

      {!loading && timeline.teachers.length > 0 && (
        <div className="schedule-week-table">
          <div className="schedule-week-row schedule-week-head">
            <div className="teacher-column">老师</div>
            {weekDays.map((date, index) => (
              <div className="day-column" key={date}>
                <span>{WEEKDAY_LABELS[index]}</span>
                <strong>{date.slice(5)}</strong>
              </div>
            ))}
          </div>

          {timeline.teachers.map((teacher) => {
            const entriesByDate = groupEntriesByDate(teacher.entries || []);
            return (
              <div className="schedule-week-row" key={teacher.teacherId || teacher.teacherName}>
                <div className="teacher-column">
                  <strong>{teacher.teacherName || '未命名老师'}</strong>
                  <span>#{teacher.teacherId}</span>
                </div>
                {weekDays.map((date) => (
                  <div className="day-column" key={date}>
                    {(entriesByDate[date] || []).map((entry) => (
                      <article className="schedule-card" key={entry.id}>
                        <div className="schedule-card-time">{formatTimeRange(entry)}</div>
                        <strong>{entry.studentName || '未命名学生'}</strong>
                        <span>{entry.companyName || '未填写公司'} · {entry.positionName || '未填写岗位'}</span>
                        <StatusBadge status={entry.status} />
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
