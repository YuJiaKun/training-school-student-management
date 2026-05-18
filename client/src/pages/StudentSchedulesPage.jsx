import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiUpload } from '../api.js';
import InterviewScheduleCalendar, {
  scheduleToCalendarEvent,
  toLocalDateTimeValue
} from '../components/InterviewScheduleCalendar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const EMPTY_SCHEDULE_FORM = {
  teacherId: '',
  teacherName: '',
  companyName: '',
  positionName: '',
  startsAt: '',
  durationMinutes: '60',
  remark: ''
};

const BOOKING_DURATIONS = [30, 60, 90, 120];

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return toLocalDateTimeValue(date);
}

function selectionDurationMinutes(selectionInfo) {
  const diff = selectionInfo.end.getTime() - selectionInfo.start.getTime();
  const minutes = Math.round(diff / 60000);
  return BOOKING_DURATIONS.includes(minutes) ? String(minutes) : '60';
}

function formatDateOnly(value) {
  return toLocalDateTimeValue(value).slice(0, 10);
}

function scheduleGuardMessage(guard, teacherCount) {
  if (!teacherCount) return '暂无可预约老师，请等待老师开启面试排期。';
  if (!guard?.canRequest && guard?.reason === 'student not eligible for scheduling') {
    if (guard?.studentStatus === 'archived') return '学生档案已归档，暂不能申请面试排期。';
    if (guard?.learningStage === 'employed') return '已就业学生默认不再开放新的面试排期。';
    return '当前为学习中，进入求职中后可申请面试排期。';
  }
  if (!guard?.canRequest && guard?.reason === 'interview transcript required') {
    return '请先补齐已完成面试的 TXT 面试记录后再申请新的排期。';
  }
  if (!guard?.canRequest && guard?.reason === 'unfinished schedule limit reached') {
    return `当前未完成面试已达 ${guard.maxUnfinishedCount || 3} 个，请等待处理后再申请。`;
  }
  if (!guard?.canRequest) return '当前暂不可申请面试排期，请联系教务老师处理。';
  return '在日历里拖选空闲时间段，确认公司和岗位后提交申请。';
}

function normalizeWorkspacePayload(payload) {
  return {
    student: payload?.student || payload?.currentStudent || null,
    scheduleGuard: payload?.scheduleGuard || {
      canRequest: false,
      unfinishedCount: 0,
      maxUnfinishedCount: 3,
      pendingTranscriptSchedules: []
    }
  };
}

function getTranscriptFile(formElement) {
  return formElement.querySelector('[data-transcript-file="true"]')?.files?.[0] || null;
}

export default function StudentSchedulesPage({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [scheduleGuard, setScheduleGuard] = useState({
    canRequest: false,
    unfinishedCount: 0,
    maxUnfinishedCount: 3,
    pendingTranscriptSchedules: []
  });
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE_FORM);
  const [scheduleWeekStart, setScheduleWeekStart] = useState('');
  const [scheduleTeacherFilter, setScheduleTeacherFilter] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [requestingSchedule, setRequestingSchedule] = useState(false);
  const [uploadingTranscriptId, setUploadingTranscriptId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadStudentData() {
    setLoading(true);
    setError('');
    try {
      const payload = await apiGet('/api/student-workspace');
      const workspace = normalizeWorkspacePayload(payload);
      setStudent(workspace.student);
      setScheduleGuard(workspace.scheduleGuard);
    } catch (err) {
      setStudent(null);
      setScheduleGuard({
        canRequest: false,
        reason: 'student account not bound',
        unfinishedCount: 0,
        maxUnfinishedCount: 3,
        pendingTranscriptSchedules: []
      });
      setError(err.message || '学生排期加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadTeachers() {
    try {
      const data = await apiGet('/api/teachers');
      const items = data.items || [];
      setTeachers(items);
      setScheduleForm((current) => {
        if (current.teacherId || !items[0]) return current;
        return { ...current, teacherId: String(items[0].id), teacherName: items[0].name || '' };
      });
    } catch (err) {
      setTeachers([]);
      setError(err.message || '可预约老师加载失败');
    }
  }

  useEffect(() => {
    loadStudentData();
    loadTeachers();
  }, [user.studentId, user.username]);

  const scheduleEvents = useMemo(() => {
    return scheduleEntries.map((schedule) => scheduleToCalendarEvent(schedule, { privacyMode: true }));
  }, [scheduleEntries]);

  const selectedTeacher = useMemo(() => {
    return teachers.find((teacher) => String(teacher.id) === String(scheduleForm.teacherId));
  }, [scheduleForm.teacherId, teachers]);

  const canRequestSchedule = Boolean(scheduleGuard?.canRequest && teachers.length);
  const scheduleHint = scheduleGuardMessage(scheduleGuard, teachers.length);
  const scheduleEndsAt = scheduleForm.startsAt ? addMinutes(scheduleForm.startsAt, scheduleForm.durationMinutes) : '';
  const pendingTranscriptSchedules = scheduleGuard?.pendingTranscriptSchedules || [];
  const pendingTranscriptCount = pendingTranscriptSchedules.length;

  function updateScheduleForm(field, value) {
    setScheduleForm((current) => ({ ...current, [field]: value }));
  }

  async function loadScheduleEntries(nextWeekStart = scheduleWeekStart, nextTeacherId = scheduleTeacherFilter) {
    if (!nextWeekStart) return;
    setLoadingSchedules(true);
    try {
      const params = new URLSearchParams({ weekStart: nextWeekStart });
      if (nextTeacherId) params.set('teacherId', nextTeacherId);
      const data = await apiGet(`/api/student-workspace/schedules/week?${params.toString()}`);
      const entries = data.entries || [];
      setScheduleEntries(entries);
      setSelectedSchedule((current) => {
        if (!current) return null;
        return entries.find((entry) => Number(entry.id) === Number(current.id)) || null;
      });
    } catch (err) {
      setScheduleEntries([]);
      setError(err.message || '本周排期加载失败');
    } finally {
      setLoadingSchedules(false);
    }
  }

  function handleScheduleDatesSet(rangeInfo) {
    const nextWeekStart = formatDateOnly(rangeInfo.start);
    setScheduleWeekStart(nextWeekStart);
    loadScheduleEntries(nextWeekStart, scheduleTeacherFilter);
  }

  function handleScheduleTeacherFilterChange(value) {
    setScheduleTeacherFilter(value);
    if (scheduleWeekStart) loadScheduleEntries(scheduleWeekStart, value);
  }

  function handleScheduleTeacherChange(value) {
    const teacher = teachers.find((item) => String(item.id) === String(value));
    setScheduleForm((current) => ({
      ...current,
      teacherId: value,
      teacherName: teacher?.name || ''
    }));
  }

  function handleCalendarSelect(selectionInfo) {
    if (!canRequestSchedule) return;
    setScheduleForm((current) => ({
      ...current,
      startsAt: toLocalDateTimeValue(selectionInfo.start),
      durationMinutes: selectionDurationMinutes(selectionInfo)
    }));
    setSuccess('已选中日历时间，请确认预约信息后提交申请。');
  }

  async function handleScheduleRequestSubmit(event) {
    event.preventDefault();
    if (!canRequestSchedule) {
      setError(scheduleHint);
      return;
    }
    if (!scheduleForm.teacherId) {
      setError('请选择预约老师');
      return;
    }
    if (!scheduleForm.startsAt) {
      setError('请先在日历上选择预约开始时间');
      return;
    }

    const durationMinutes = Number(scheduleForm.durationMinutes || 60);
    const payload = {
      teacherId: Number(scheduleForm.teacherId),
      teacherName: selectedTeacher?.name || scheduleForm.teacherName || '',
      companyName: scheduleForm.companyName.trim(),
      positionName: scheduleForm.positionName.trim(),
      startsAt: scheduleForm.startsAt,
      endsAt: addMinutes(scheduleForm.startsAt, durationMinutes),
      remark: scheduleForm.remark.trim()
    };

    setRequestingSchedule(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('/api/schedules', payload);
      setSuccess('面试预约申请已提交，等待老师或管理员确认。');
      setScheduleForm((current) => ({
        ...EMPTY_SCHEDULE_FORM,
        teacherId: current.teacherId,
        teacherName: selectedTeacher?.name || current.teacherName || '',
        durationMinutes: '60'
      }));
      await loadStudentData();
      await loadScheduleEntries();
    } catch (err) {
      setError(err.message || '面试预约申请提交失败');
    } finally {
      setRequestingSchedule(false);
    }
  }

  async function handleCancelSchedule(schedule) {
    setRequestingSchedule(true);
    setError('');
    setSuccess('');
    try {
      await apiPost(`/api/schedules/${schedule.id}/cancel`, {});
      setSuccess('预约申请已取消。');
      setSelectedSchedule(null);
      await loadStudentData();
      await loadScheduleEntries();
    } catch (err) {
      setError(err.message || '取消预约失败');
    } finally {
      setRequestingSchedule(false);
    }
  }

  async function handleTranscriptUpload(event, schedule) {
    event.preventDefault();
    const file = getTranscriptFile(event.currentTarget);
    if (!file) {
      setError('请选择要上传的 TXT 面试记录');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setUploadingTranscriptId(schedule.id);
    setError('');
    setSuccess('');
    try {
      await apiUpload(`/api/schedules/${schedule.id}/transcript`, formData);
      setSuccess('面试记录已上传，现在可以继续申请新的排期。');
      await loadStudentData();
      await loadScheduleEntries();
    } catch (err) {
      setError(err.message || '面试记录上传失败');
    } finally {
      setUploadingTranscriptId(null);
    }
  }

  return (
    <section className="page student-schedules-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">学生端</p>
          <h1>我的排期</h1>
          <p className="muted">按 30 分钟粒度查看本周占用，选择空闲时间后提交预约申请。</p>
        </div>
        <StatusBadge status={canRequestSchedule ? 'job_seeking' : 'pending'}>
          未完成面试 {scheduleGuard?.unfinishedCount || 0}/{scheduleGuard?.maxUnfinishedCount || 3}
        </StatusBadge>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}
      {loading ? <div className="empty-state">正在加载我的排期...</div> : null}

      {!loading && !student?.id ? (
        <div className="empty-state">当前账号尚未绑定学生档案，请联系管理员完成绑定后再预约面试。</div>
      ) : null}

      {!loading && student?.id ? (
        <>
          <section className="panel student-schedule-panel">
            <div className="panel-header">
              <div>
                <h2>本周排期与申请</h2>
                <p className="muted">{scheduleHint}</p>
              </div>
              <div className="student-schedule-controls">
                <label>
                  查看老师
                  <select value={scheduleTeacherFilter} onChange={(event) => handleScheduleTeacherFilterChange(event.target.value)}>
                    <option value="">全部可预约老师</option>
                    {teachers.map((teacher) => (
                      <option value={teacher.id} key={teacher.id}>{teacher.name || `老师 #${teacher.id}`}</option>
                    ))}
                  </select>
                </label>
                <div className="record-meta-row">
                  <StatusBadge status={student.learningStage || 'studying'} />
                  {pendingTranscriptCount ? <StatusBadge status="pending">待补记录 {pendingTranscriptCount}</StatusBadge> : null}
                </div>
              </div>
            </div>

            {pendingTranscriptCount ? (
              <section className="pending-transcript-panel">
                <div>
                  <h3>待上传面试记录</h3>
                  <p className="muted">完成面试后需要上传 TXT 面试记录，上传后才能继续申请新的排期。</p>
                </div>
                <div className="pending-transcript-list">
                  {pendingTranscriptSchedules.map((schedule) => (
                    <article className="pending-transcript-item" key={schedule.id}>
                      <div>
                        <strong>{schedule.companyName || '未填写公司'} / {schedule.positionName || '未填写岗位'}</strong>
                        <p className="muted">
                          {schedule.teacherName || '未命名老师'} · {formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}
                        </p>
                      </div>
                      <form className="transcript-upload-form" onSubmit={(event) => handleTranscriptUpload(event, schedule)}>
                        <input data-transcript-file="true" type="file" accept=".txt,text/plain" disabled={uploadingTranscriptId === schedule.id} required />
                        <button className="button button-primary" type="submit" disabled={uploadingTranscriptId === schedule.id}>
                          {uploadingTranscriptId === schedule.id ? '正在上传...' : '上传 TXT 记录'}
                        </button>
                      </form>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="student-schedule-grid">
              <div className="student-schedule-calendar">
                {loadingSchedules ? <div className="inline-loading">正在加载本周排期...</div> : null}
                <InterviewScheduleCalendar
                  events={scheduleEvents}
                  selectable={canRequestSchedule}
                  onDatesSet={handleScheduleDatesSet}
                  onSelect={handleCalendarSelect}
                  onEventClick={(info) => setSelectedSchedule(info.event.extendedProps.schedule)}
                />
              </div>

              <div className="student-schedule-right">
                <form className="student-schedule-form" onSubmit={handleScheduleRequestSubmit}>
                  <div>
                    <h3>提交预约申请</h3>
                    <p className="muted">默认 1 小时，也可以改为 30/90/120 分钟。</p>
                  </div>
                  <label>
                    预约老师
                    <select
                      value={scheduleForm.teacherId}
                      onChange={(event) => handleScheduleTeacherChange(event.target.value)}
                      disabled={requestingSchedule || !teachers.length}
                      required
                    >
                      {!teachers.length ? <option value="">暂无可预约老师</option> : null}
                      {teachers.map((teacher) => (
                        <option value={teacher.id} key={teacher.id}>{teacher.name || `老师 #${teacher.id}`}</option>
                      ))}
                    </select>
                  </label>
                  <div className="form-row two">
                    <label>
                      公司
                      <input
                        value={scheduleForm.companyName}
                        onChange={(event) => updateScheduleForm('companyName', event.target.value)}
                        placeholder="例如：数据科技公司"
                        disabled={requestingSchedule}
                      />
                    </label>
                    <label>
                      岗位
                      <input
                        value={scheduleForm.positionName}
                        onChange={(event) => updateScheduleForm('positionName', event.target.value)}
                        placeholder="例如：数据分析实习"
                        disabled={requestingSchedule}
                      />
                    </label>
                  </div>
                  <label>
                    开始时间
                    <input
                      type="datetime-local"
                      value={scheduleForm.startsAt ? scheduleForm.startsAt.slice(0, 16) : ''}
                      onChange={(event) => updateScheduleForm('startsAt', event.target.value ? `${event.target.value}:00` : '')}
                      disabled={requestingSchedule}
                      step="1800"
                      required
                    />
                  </label>
                  <div className="form-row two">
                    <label>
                      时长
                      <select
                        value={scheduleForm.durationMinutes}
                        onChange={(event) => updateScheduleForm('durationMinutes', event.target.value)}
                        disabled={requestingSchedule}
                      >
                        {BOOKING_DURATIONS.map((minutes) => (
                          <option value={minutes} key={minutes}>{minutes} 分钟</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      结束时间
                      <input value={scheduleEndsAt ? formatDateTime(scheduleEndsAt) : '选择开始时间后自动计算'} readOnly />
                    </label>
                  </div>
                  <label>
                    备注
                    <textarea
                      value={scheduleForm.remark}
                      onChange={(event) => updateScheduleForm('remark', event.target.value)}
                      placeholder="补充面试形式、注意事项或其他说明"
                      disabled={requestingSchedule}
                    />
                  </label>
                  <button className="button button-primary" type="submit" disabled={!canRequestSchedule || requestingSchedule}>
                    {requestingSchedule ? '正在提交...' : '提交预约申请'}
                  </button>
                </form>

                {selectedSchedule ? (
                  <div className="schedule-selected-actions student-selected-schedule">
                    <div>
                      <strong>{selectedSchedule.isOwn ? '我的预约' : '已占用时间'}</strong>
                      <p className="muted">
                        {selectedSchedule.teacherName || '未命名老师'} · {formatDateTime(selectedSchedule.startsAt)} 至 {formatDateTime(selectedSchedule.endsAt)}
                      </p>
                      <p className="muted">{selectedSchedule.companyName || '未填写公司'} / {selectedSchedule.positionName || '未填写岗位'}</p>
                    </div>
                    <StatusBadge status={selectedSchedule.status} />
                    {selectedSchedule.isOwn && selectedSchedule.transcriptFileName ? (
                      <p className="muted selected-transcript-link">
                        已上传：{selectedSchedule.transcriptFileName}
                        {selectedSchedule.transcriptUploadedAt ? ` / ${formatDateTime(selectedSchedule.transcriptUploadedAt)}` : ''}
                        <a className="inline-link" href={`/api/schedules/${selectedSchedule.id}/transcript`}>下载记录</a>
                      </p>
                    ) : null}
                    {selectedSchedule.isOwn && selectedSchedule.status === 'completed' && !selectedSchedule.transcriptUploadedAt ? (
                      <form className="transcript-upload-form selected-transcript-form" onSubmit={(event) => handleTranscriptUpload(event, selectedSchedule)}>
                        <input data-transcript-file="true" type="file" accept=".txt,text/plain" disabled={uploadingTranscriptId === selectedSchedule.id} required />
                        <button className="button button-primary" type="submit" disabled={uploadingTranscriptId === selectedSchedule.id}>
                          {uploadingTranscriptId === selectedSchedule.id ? '正在上传...' : '上传面试记录'}
                        </button>
                      </form>
                    ) : null}
                    {selectedSchedule.isOwn && selectedSchedule.status === 'requested' ? (
                      <button className="button button-secondary" type="button" disabled={requestingSchedule} onClick={() => handleCancelSchedule(selectedSchedule)}>
                        取消申请
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
