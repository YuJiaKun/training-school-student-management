import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiUpload } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';

const EMPTY_FORM = {
  teacherId: '',
  teacherName: '',
  companyName: '',
  positionName: '',
  startsAt: '',
  endsAt: '',
  remark: ''
};

const EMPTY_PROFILE_FORM = {
  phone: '',
  gender: '',
  birthday: '',
  enrolledAt: '',
  remark: ''
};

const DEFAULT_SCHEDULE_GUARD = {
  canRequest: true,
  reason: '',
  unfinishedCount: 0,
  maxUnfinishedCount: 3,
  pendingTranscriptSchedules: []
};

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  return value.slice(5).replace('-', '/');
}

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function readList(payload, key, fallbackKey) {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;

  const fallbackValue = payload?.[fallbackKey];
  if (Array.isArray(fallbackValue)) return fallbackValue;
  if (Array.isArray(fallbackValue?.items)) return fallbackValue.items;

  return [];
}

function normalizeWorkspacePayload(payload) {
  return {
    student: payload?.student || payload?.currentStudent || null,
    homeworkRecords: readList(payload, 'homeworkRecords', 'homework'),
    interviewRecords: readList(payload, 'interviewRecords', 'interviews'),
    schedules: readList(payload, 'schedules', 'interviewSchedules'),
    scheduleGuard: payload?.scheduleGuard || DEFAULT_SCHEDULE_GUARD
  };
}

function toProfileForm(student) {
  return {
    phone: student?.phone || '',
    gender: student?.gender || '',
    birthday: student?.birthday || '',
    enrolledAt: student?.enrolledAt || '',
    remark: student?.remark || ''
  };
}

function applyDefaultTeacher(form, teachers) {
  if (form.teacherId || !teachers.length) return form;
  const firstTeacher = teachers[0];
  return { ...form, teacherId: String(firstTeacher.id), teacherName: firstTeacher.name };
}

function findTeacher(teachers, teacherId) {
  return teachers.find((teacher) => Number(teacher.id) === Number(teacherId));
}

function homeworkStatusText(status) {
  if (status === 'submitted' || status === 'reviewed') return '已提交';
  if (status === 'pending') return '待提交';
  return statusText(status);
}

function scheduleGuardText(reason) {
  if (reason === 'interview transcript required') return '请先上传已完成面试的 TXT 面试记录，再申请新的排期。';
  if (reason === 'unfinished schedule limit reached') return '当前未完成面试已达 3 个，请等待处理后再申请新的排期。';
  return reason || '';
}

function isTranscriptMissing(schedule) {
  return schedule.status === 'completed' && !schedule.transcriptUploadedAt;
}

function homeworkPriority(record) {
  if (record.lateStatus === 'overduePending') return 0;
  if (!['submitted', 'reviewed'].includes(record.submitStatus)) return 1;
  return 2;
}

export default function StudentWorkspace({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [homeworkRecords, setHomeworkRecords] = useState([]);
  const [interviewRecords, setInterviewRecords] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [scheduleGuard, setScheduleGuard] = useState(DEFAULT_SCHEDULE_GUARD);
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart());
  const [weeklySchedules, setWeeklySchedules] = useState({ weeks: [], entries: [] });
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingHomeworkId, setSubmittingHomeworkId] = useState(null);
  const [uploadingTranscriptId, setUploadingTranscriptId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const hasStudent = Boolean(student?.id);

  async function loadStudentData() {
    setLoading(true);
    setError('');
    try {
      const [payload, teacherPayload] = await Promise.all([
        apiGet('/api/student-workspace'),
        apiGet('/api/teachers')
      ]);
      const workspace = normalizeWorkspacePayload(payload);
      const teacherItems = Array.isArray(teacherPayload?.items) ? teacherPayload.items : [];
      const weeklyPayload = workspace.student
        ? await apiGet(`/api/student-workspace/schedules/week?weekStart=${encodeURIComponent(weekStart)}`)
        : { weeks: [], entries: [] };
      setStudent(workspace.student);
      setProfileForm(toProfileForm(workspace.student));
      setHomeworkRecords(workspace.homeworkRecords);
      setInterviewRecords(workspace.interviewRecords);
      setSchedules(workspace.schedules);
      setScheduleGuard(workspace.scheduleGuard || DEFAULT_SCHEDULE_GUARD);
      setWeeklySchedules({
        weeks: Array.isArray(weeklyPayload.weeks) ? weeklyPayload.weeks : [],
        entries: Array.isArray(weeklyPayload.entries) ? weeklyPayload.entries : []
      });
      setTeachers(teacherItems);
      setForm((current) => applyDefaultTeacher(current, teacherItems));
    } catch (err) {
      setStudent(null);
      setHomeworkRecords([]);
      setInterviewRecords([]);
      setSchedules([]);
      setScheduleGuard(DEFAULT_SCHEDULE_GUARD);
      setWeeklySchedules({ weeks: [], entries: [] });
      setTeachers([]);
      setError(err.message || '学生工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudentData();
  }, [user.studentId, user.username, weekStart]);

  const overview = useMemo(() => {
    const submittedHomework = homeworkRecords.filter((record) =>
      ['submitted', 'reviewed'].includes(record.submitStatus)
    ).length;
    const upcomingSchedules = schedules.filter((schedule) =>
      !['completed', 'cancelled'].includes(schedule.status)
    ).length;
    return [
      { label: '作业记录', value: homeworkRecords.length },
      { label: '已提交作业', value: submittedHomework },
      { label: '面试记录', value: interviewRecords.length },
      { label: '进行中排期', value: upcomingSchedules }
    ];
  }, [homeworkRecords, interviewRecords, schedules]);

  const weeklyScheduleDays = useMemo(() => {
    const days = weeklySchedules.weeks.length
      ? weeklySchedules.weeks
      : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    return days.map((day) => ({
      day,
      entries: weeklySchedules.entries.filter((entry) => String(entry.startsAt || '').startsWith(day))
    }));
  }, [weekStart, weeklySchedules]);

  const pendingTranscriptSchedules = Array.isArray(scheduleGuard.pendingTranscriptSchedules)
    ? scheduleGuard.pendingTranscriptSchedules
    : [];
  const requestBlockedReason = scheduleGuard.canRequest ? '' : scheduleGuardText(scheduleGuard.reason);
  const requestDisabled = !hasStudent || submitting || !teachers.length || !scheduleGuard.canRequest;
  const sortedHomeworkRecords = useMemo(() => {
    return [...homeworkRecords].sort((left, right) => {
      const priority = homeworkPriority(left) - homeworkPriority(right);
      if (priority !== 0) return priority;
      return String(left.dueDate || '').localeCompare(String(right.dueDate || ''));
    });
  }, [homeworkRecords]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileForm(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  function updateTeacher(teacherId) {
    const teacher = findTeacher(teachers, teacherId);
    setForm((current) => ({
      ...current,
      teacherId,
      teacherName: teacher?.name || ''
    }));
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    if (!student?.id) return;

    const payload = {
      phone: profileForm.phone.trim(),
      gender: profileForm.gender.trim(),
      birthday: profileForm.birthday,
      enrolledAt: profileForm.enrolledAt,
      remark: profileForm.remark.trim()
    };

    setSavingProfile(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiPatch('/api/student-workspace/profile', payload);
      const nextStudent = result.student || { ...student, ...payload };
      setStudent(nextStudent);
      setProfileForm(toProfileForm(nextStudent));
      setSuccess('个人资料已保存，姓名和班级/课程仍由教务端统一维护。');
    } catch (err) {
      setError(err.message || '个人资料保存失败');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!student?.id) return;

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('/api/schedules', {
        studentId: student.id,
        teacherId: Number(form.teacherId),
        teacherName: form.teacherName.trim(),
        companyName: form.companyName.trim(),
        positionName: form.positionName.trim(),
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        remark: form.remark.trim()
      });
      setForm(applyDefaultTeacher(EMPTY_FORM, teachers));
      setSuccess('排期申请已提交，等待老师接收。');
      await loadStudentData();
    } catch (err) {
      setError(err.message || '排期申请提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleHomeworkSubmit(event, record) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.homeworkFile;
    const remarkInput = event.currentTarget.elements.homeworkRemark;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError('请先选择要上传的作业文件');
      return;
    }

    setSubmittingHomeworkId(record.id);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('remark', remarkInput?.value || '');
      await apiUpload(`/api/homework/${record.id}/submission`, formData);
      setSuccess('作业已提交，老师端会同步看到提交状态。');
      await loadStudentData();
    } catch (err) {
      setError(err.message || '作业提交失败');
    } finally {
      setSubmittingHomeworkId(null);
    }
  }

  async function handleTranscriptSubmit(event, schedule) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.transcriptFile;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError('请先选择要上传的 TXT 面试记录');
      return;
    }

    setUploadingTranscriptId(schedule.id);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiUpload(`/api/schedules/${schedule.id}/transcript`, formData);
      setSuccess('面试记录已上传，可以继续申请新的面试排期。');
      await loadStudentData();
    } catch (err) {
      setError(err.message || '面试记录上传失败');
    } finally {
      setUploadingTranscriptId(null);
    }
  }

  return (
    <section className="page student-workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">学生端</p>
          <h1>我的学习与面试中心</h1>
          <p className="muted">查看个人进度、提交作业文件和面试记录，也可以主动发起排期申请。</p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {loading && <div className="empty-state">正在加载学生工作台...</div>}

      {!loading && !hasStudent && (
        <div className="empty-state">
          当前账号尚未绑定学生档案，请联系管理员完成绑定后再查看学习进度或申请排期。
        </div>
      )}

      {!loading && hasStudent && (
        <>
          <section className="panel student-profile">
            <div>
              <p className="eyebrow">当前学生</p>
              <h2>{student.name}</h2>
              <p>{student.className || '未分配班级'} / {student.phone || '未填写手机号'}</p>
              <p className="muted">已使用当前账号绑定的学生档案加载个人工作台。</p>
            </div>
            <div className="metric-row">
              {overview.map((item) => (
                <div className="metric" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>资料补全</h2>
                <p className="muted">学生可补充联系方式和个人资料；姓名、班级/课程由教务端维护。</p>
              </div>
            </div>
            <form className="form-grid" onSubmit={handleProfileSubmit}>
              <div className="profile-readonly form-wide">
                <span>姓名：{student.name || '-'}</span>
                <span>班级/课程：{student.className || '未分配班级'}</span>
              </div>
              <label>
                手机号
                <input
                  value={profileForm.phone}
                  onChange={(event) => updateProfileForm('phone', event.target.value)}
                  placeholder="填写常用手机号"
                  disabled={savingProfile}
                />
              </label>
              <label>
                性别
                <select
                  value={profileForm.gender}
                  onChange={(event) => updateProfileForm('gender', event.target.value)}
                  disabled={savingProfile}
                >
                  <option value="">暂不填写</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              <label>
                出生日期
                <input
                  type="date"
                  value={profileForm.birthday}
                  onChange={(event) => updateProfileForm('birthday', event.target.value)}
                  disabled={savingProfile}
                />
              </label>
              <label>
                入学日期
                <input
                  type="date"
                  value={profileForm.enrolledAt}
                  onChange={(event) => updateProfileForm('enrolledAt', event.target.value)}
                  disabled={savingProfile}
                />
              </label>
              <label className="form-wide">
                备注
                <textarea
                  value={profileForm.remark}
                  onChange={(event) => updateProfileForm('remark', event.target.value)}
                  placeholder="补充学习方向、联系偏好或其他说明"
                  disabled={savingProfile}
                />
              </label>
              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={savingProfile}>
                  {savingProfile ? '正在保存...' : '保存资料'}
                </button>
              </div>
            </form>
          </section>

          <div className="workspace-grid">
            <section className="panel">
              <div className="panel-header">
                <h2>作业提交</h2>
                <span>{homeworkRecords.length} 条</span>
              </div>
              {!homeworkRecords.length && <div className="empty-state">暂无作业记录。</div>}
              <div className="record-list">
                {sortedHomeworkRecords.map((record) => (
                  <article className="record-item" key={record.id}>
                    <div className="record-main">
                      <strong>{record.homeworkName || '未命名作业'}</strong>
                      <p>
                        {record.className || '未填写班级'} / <StatusBadge status={record.submitStatus === 'reviewed' ? 'submitted' : record.submitStatus}>
                          {homeworkStatusText(record.submitStatus)}
                        </StatusBadge>
                        {record.lateStatus ? <StatusBadge status={record.lateStatus}>{record.lateStatusText}</StatusBadge> : null}
                      </p>
                      <p className="muted">
                        截止日期：{record.dueDate || '未设置'}；提交时间：{record.submitAt ? record.submitAt.replace('T', ' ').slice(0, 16) : '未提交'}
                      </p>
                      {record.description ? <p className="muted">说明：{record.description}</p> : null}
                      {record.fileName ? (
                        <p className="muted">
                          已上传：{record.fileName}{formatFileSize(record.fileSize) ? ` / ${formatFileSize(record.fileSize)}` : ''}
                          <a className="inline-link" href={`/api/homework/${record.id}/file`}>下载我已提交的文件</a>
                        </p>
                      ) : null}
                    </div>
                    <form className="homework-upload-form" onSubmit={(event) => handleHomeworkSubmit(event, record)}>
                      <input
                        name="homeworkFile"
                        type="file"
                        accept=".txt,text/plain"
                        disabled={submittingHomeworkId === record.id}
                        required
                      />
                      <input
                        name="homeworkRemark"
                        placeholder="备注，可选"
                        disabled={submittingHomeworkId === record.id}
                      />
                      <button className="button button-primary" type="submit" disabled={submittingHomeworkId === record.id}>
                        {submittingHomeworkId === record.id ? '正在上传...' : record.fileName ? '重新上传' : '上传作业'}
                      </button>
                    </form>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>面试记录</h2>
                <span>{interviewRecords.length} 条</span>
              </div>
              {!interviewRecords.length && <div className="empty-state">暂无面试记录。</div>}
              <div className="record-list">
                {interviewRecords.map((record) => (
                  <article className="record-item" key={record.id}>
                    <div>
                      <strong>{record.companyName || '未填写公司'} / {record.positionName || '未填写岗位'}</strong>
                      <p>{formatDateTime(record.interviewAt)} / <StatusBadge status={record.result} /></p>
                      <p className="muted">
                        反馈：{record.feedback || '暂无'}；入职状态：
                        {record.hiredStatus ? statusText(record.hiredStatus) : '未记录'}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {!loading && hasStudent && pendingTranscriptSchedules.length > 0 && (
        <section className="panel schedule-guard-panel">
          <div className="panel-header">
            <div>
              <h2>待上传面试记录</h2>
              <p className="muted">以下面试已完成，请先上传 TXT 面试记录后再申请新的排期。</p>
            </div>
            <StatusBadge status="pending">待处理 {pendingTranscriptSchedules.length}</StatusBadge>
          </div>
          <div className="record-list">
            {pendingTranscriptSchedules.map((schedule) => (
              <article className="record-item" key={schedule.id}>
                <div>
                  <strong>{schedule.companyName || '未填写公司'} / {schedule.positionName || '未填写岗位'}</strong>
                  <p>{formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                  <p className="muted">老师：{schedule.teacherName || '未填写老师'}</p>
                </div>
                <form className="transcript-upload-form" onSubmit={(event) => handleTranscriptSubmit(event, schedule)}>
                  <input
                    name="transcriptFile"
                    type="file"
                    accept=".txt,text/plain"
                    disabled={uploadingTranscriptId === schedule.id}
                    required
                  />
                  <button className="button button-primary" type="submit" disabled={uploadingTranscriptId === schedule.id}>
                    {uploadingTranscriptId === schedule.id ? '正在上传...' : '上传面试记录'}
                  </button>
                </form>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>本周排期与申请</h2>
            <p className="muted">先查看本周老师时间占用，再提交新的面试排期申请。</p>
          </div>
          <div className="schedule-week-controls">
            <button className="button" type="button" onClick={() => setWeekStart((current) => addDays(current, -7))}>上一周</button>
            <span>{formatDate(weeklyScheduleDays[0]?.day)} - {formatDate(weeklyScheduleDays[6]?.day)}</span>
            <button className="button" type="button" onClick={() => setWeekStart((current) => addDays(current, 7))}>下一周</button>
          </div>
        </div>

        {hasStudent && (
          <div className="schedule-request-status">
            <span>当前未完成面试 {scheduleGuard.unfinishedCount || 0}/{scheduleGuard.maxUnfinishedCount || 3}</span>
            {requestBlockedReason ? <strong>{requestBlockedReason}</strong> : <strong>可以提交新的排期申请</strong>}
          </div>
        )}

        {hasStudent && (
          <div className="weekly-schedule-grid">
            {weeklyScheduleDays.map((day) => (
              <div className="weekly-schedule-day" key={day.day}>
                <div className="weekly-schedule-date">{formatDate(day.day)}</div>
                {!day.entries.length ? <p className="muted">暂无排期</p> : null}
                {day.entries.map((entry) => (
                  <article className={`weekly-schedule-entry${entry.isOwn ? ' is-own' : ''}`} key={entry.id}>
                    <div>
                      <strong>{formatDateTime(entry.startsAt).slice(11)} - {formatDateTime(entry.endsAt).slice(11)}</strong>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p>{entry.teacherName || '未填写老师'} / {entry.companyName || '未填写公司'}</p>
                    <p className="muted">{entry.positionName || '未填写岗位'}{entry.isOwn ? ' / 我的排期' : ''}</p>
                  </article>
                ))}
              </div>
            ))}
          </div>
        )}

        <form className="schedule-form" onSubmit={handleSubmit}>
          <label>
            面试老师
            <select disabled={requestDisabled} value={form.teacherId} onChange={(event) => updateTeacher(event.target.value)} required>
              <option value="">选择老师</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
              ))}
            </select>
          </label>
          <label>
            公司名称
            <input disabled={requestDisabled} value={form.companyName} onChange={(event) => updateForm('companyName', event.target.value)} placeholder="例如：星河科技" />
          </label>
          <label>
            面试岗位
            <input disabled={requestDisabled} value={form.positionName} onChange={(event) => updateForm('positionName', event.target.value)} placeholder="例如：前端工程师" />
          </label>
          <label>
            开始时间
            <input disabled={requestDisabled} type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} required />
          </label>
          <label>
            结束时间
            <input disabled={requestDisabled} type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} required />
          </label>
          <label className="form-wide">
            申请说明
            <textarea disabled={requestDisabled} value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="补充期望时间、面试形式或其他说明" />
          </label>
          <button className="button button-primary" type="submit" disabled={requestDisabled}>
            {submitting ? '正在提交...' : '提交排期申请'}
          </button>
        </form>

        {hasStudent && !teachers.length ? (
          <p className="muted">暂无可预约老师，请联系老师开启面试排期。</p>
        ) : null}

        {hasStudent && schedules.length > 0 && (
          <div className="record-list">
            {schedules.map((schedule) => (
              <article className="record-item" key={schedule.id}>
                <div className="record-main">
                  <strong>{schedule.companyName || '未填写公司'} / {schedule.positionName || '未填写岗位'}</strong>
                  <p>{formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                  <p className="muted">老师：{schedule.teacherName || '未填写老师'}</p>
                  <div className="record-meta-row">
                    <StatusBadge status={schedule.status} />
                    {schedule.transcriptUploadedAt ? (
                      <a className="link-button" href={`/api/schedules/${schedule.id}/transcript`}>下载面试记录</a>
                    ) : null}
                    {isTranscriptMissing(schedule) ? <StatusBadge status="pending">待上传 TXT 记录</StatusBadge> : null}
                  </div>
                </div>
                {isTranscriptMissing(schedule) ? (
                  <form className="transcript-upload-form" onSubmit={(event) => handleTranscriptSubmit(event, schedule)}>
                    <input
                      name="transcriptFile"
                      type="file"
                      accept=".txt,text/plain"
                      disabled={uploadingTranscriptId === schedule.id}
                      required
                    />
                    <button className="button button-primary" type="submit" disabled={uploadingTranscriptId === schedule.id}>
                      {uploadingTranscriptId === schedule.id ? '正在上传...' : '上传面试记录'}
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {!hasStudent && <p className="muted">账号未绑定学生档案时，暂不能提交排期申请。</p>}
      </section>
    </section>
  );
}
