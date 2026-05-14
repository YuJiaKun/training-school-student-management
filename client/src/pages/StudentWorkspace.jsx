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

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
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
    schedules: readList(payload, 'schedules', 'interviewSchedules')
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

export default function StudentWorkspace({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [homeworkRecords, setHomeworkRecords] = useState([]);
  const [interviewRecords, setInterviewRecords] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingHomeworkId, setSubmittingHomeworkId] = useState(null);
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
      setStudent(workspace.student);
      setProfileForm(toProfileForm(workspace.student));
      setHomeworkRecords(workspace.homeworkRecords);
      setInterviewRecords(workspace.interviewRecords);
      setSchedules(workspace.schedules);
      setTeachers(teacherItems);
      setForm((current) => applyDefaultTeacher(current, teacherItems));
    } catch (err) {
      setStudent(null);
      setHomeworkRecords([]);
      setInterviewRecords([]);
      setSchedules([]);
      setTeachers([]);
      setError(err.message || '学生工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudentData();
  }, [user.studentId, user.username]);

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
                {homeworkRecords.map((record) => (
                  <article className="record-item" key={record.id}>
                    <div className="record-main">
                      <strong>{record.homeworkName || '未命名作业'}</strong>
                      <p>
                        {record.className || '未填写班级'} / <StatusBadge status={record.submitStatus === 'reviewed' ? 'submitted' : record.submitStatus}>
                          {homeworkStatusText(record.submitStatus)}
                        </StatusBadge>
                      </p>
                      <p className="muted">
                        截止日期：{record.dueDate || '未设置'}；提交时间：{record.submitAt ? record.submitAt.replace('T', ' ').slice(0, 16) : '未提交'}
                      </p>
                      {record.description ? <p className="muted">说明：{record.description}</p> : null}
                      {record.fileName ? <p className="muted">已上传：{record.fileName}</p> : null}
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

      <section className="panel">
        <div className="panel-header">
          <h2>申请排期</h2>
          <span>{schedules.length} 条历史排期</span>
        </div>
        <form className="schedule-form" onSubmit={handleSubmit}>
          <label>
            面试老师
            <select disabled={!hasStudent || submitting || !teachers.length} value={form.teacherId} onChange={(event) => updateTeacher(event.target.value)} required>
              <option value="">选择老师</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
              ))}
            </select>
          </label>
          <label>
            公司名称
            <input disabled={!hasStudent || submitting} value={form.companyName} onChange={(event) => updateForm('companyName', event.target.value)} placeholder="例如：星河科技" />
          </label>
          <label>
            面试岗位
            <input disabled={!hasStudent || submitting} value={form.positionName} onChange={(event) => updateForm('positionName', event.target.value)} placeholder="例如：前端工程师" />
          </label>
          <label>
            开始时间
            <input disabled={!hasStudent || submitting} type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} required />
          </label>
          <label>
            结束时间
            <input disabled={!hasStudent || submitting} type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} required />
          </label>
          <label className="form-wide">
            申请说明
            <textarea disabled={!hasStudent || submitting} value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="补充期望时间、面试形式或其他说明" />
          </label>
          <button className="button button-primary" type="submit" disabled={!hasStudent || submitting || !teachers.length}>
            {submitting ? '正在提交...' : '提交排期申请'}
          </button>
        </form>

        {hasStudent && schedules.length > 0 && (
          <div className="record-list">
            {schedules.map((schedule) => (
              <article className="record-item" key={schedule.id}>
                <div>
                  <strong>{schedule.companyName || '未填写公司'} / {schedule.positionName || '未填写岗位'}</strong>
                  <p>{formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                  <StatusBadge status={schedule.status} />
                </div>
              </article>
            ))}
          </div>
        )}

        {!hasStudent && <p className="muted">账号未绑定学生档案时，暂不能提交排期申请。</p>}
      </section>
    </section>
  );
}
