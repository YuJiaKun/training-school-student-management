import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import { statusText } from './StatusBadge.jsx';

const STATUS_COLORS = {
  requested: { backgroundColor: '#fff7ed', borderColor: '#fb923c', textColor: '#9a3412' },
  scheduled: { backgroundColor: '#eff6ff', borderColor: '#60a5fa', textColor: '#1d4ed8' },
  confirmed: { backgroundColor: '#ecfdf5', borderColor: '#34d399', textColor: '#047857' },
  rescheduled: { backgroundColor: '#f5f3ff', borderColor: '#a78bfa', textColor: '#6d28d9' },
  completed: { backgroundColor: '#f8fafc', borderColor: '#94a3b8', textColor: '#475569' },
  cancelled: { backgroundColor: '#fef2f2', borderColor: '#f87171', textColor: '#b91c1c' }
};

function formatEventTitle(schedule, privacyMode) {
  const company = schedule.companyName || '未填写公司';
  const position = schedule.positionName || '未填写岗位';
  if (privacyMode && !schedule.isOwn) return `${company} / ${position}`;
  const student = schedule.studentName || '未命名学生';
  return `${student} · ${company}`;
}

export function scheduleToCalendarEvent(schedule, options = {}) {
  const colors = STATUS_COLORS[schedule.status] || STATUS_COLORS.scheduled;
  return {
    id: String(schedule.id),
    title: formatEventTitle(schedule, options.privacyMode),
    start: schedule.startsAt,
    end: schedule.endsAt,
    editable: options.editable === true,
    durationEditable: options.editable === true,
    extendedProps: { schedule, privacyMode: options.privacyMode === true },
    ...colors
  };
}

function renderEventContent(eventInfo) {
  const schedule = eventInfo.event.extendedProps.schedule || {};
  return (
    <div className="schedule-calendar-event">
      <strong>{eventInfo.timeText} · {eventInfo.event.title}</strong>
      <span>{schedule.positionName || '未填写岗位'} / {statusText(schedule.status)}</span>
    </div>
  );
}

export function toLocalDateTimeValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}

export default function InterviewScheduleCalendar({
  events = [],
  selectable = false,
  editable = false,
  initialDate,
  onDatesSet,
  onSelect,
  onEventClick,
  onEventDrop,
  onEventResize
}) {
  return (
    <div className="schedule-calendar-shell">
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        locale={zhCnLocale}
        initialView="timeGridWeek"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'timeGridWeek,timeGridDay'
        }}
        buttonText={{ today: '今天', week: '周', day: '日' }}
        firstDay={1}
        allDaySlot={false}
        nowIndicator
        slotMinTime="08:00:00"
        slotMaxTime="22:00:00"
        slotDuration="00:30:00"
        snapDuration="00:30:00"
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        height="auto"
        expandRows
        selectable={selectable}
        editable={editable}
        eventStartEditable={editable}
        eventDurationEditable={editable}
        selectMirror
        unselectAuto={false}
        initialDate={initialDate}
        events={events}
        datesSet={onDatesSet}
        select={onSelect}
        eventClick={onEventClick}
        eventDrop={onEventDrop}
        eventResize={onEventResize}
        eventContent={renderEventContent}
      />
    </div>
  );
}
