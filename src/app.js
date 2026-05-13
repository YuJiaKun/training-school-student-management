const crypto = require('node:crypto');

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const DEFAULT_AUTH_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 },
  { username: 'student', password: 'student123', role: 'student', studentId: 1 }
];
const DEFAULT_TEACHERS = [{ id: 1, name: '张老师' }];
const VALID_ROLES = new Set(['admin', 'teacher', 'student']);
const VALID_STUDENT_STATUSES = new Set(['active', 'archived']);
const VALID_HOMEWORK_SUBMIT_STATUSES = new Set(['pending', 'submitted', 'reviewed']);
const VALID_INTERVIEW_RESULTS = new Set(['pending', 'passed', 'failed']);
const VALID_HIRED_STATUSES = new Set(['pending', 'hired', 'not_hired']);
const VALID_SCHEDULE_STATUSES = new Set(['requested', 'scheduled', 'confirmed', 'rescheduled', 'completed', 'cancelled']);
const TERMINAL_SCHEDULE_STATUSES = new Set(['completed', 'cancelled']);
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

function createAppWithOptions({
  db,
  authAccounts = DEFAULT_AUTH_ACCOUNTS,
  teachers = DEFAULT_TEACHERS,
  sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS
}) {
  const sessions = new Map();
  const loginFailures = new Map();
  const accounts = normalizeAuthAccounts(authAccounts);
  const teacherDirectory = normalizeTeachers(teachers);
  const sessionMaxAgeMs = Number(sessionMaxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS) * 1000;

  return {
    createStudent(input) {
      const name = String(input.name || '').trim();
      const phone = String(input.phone || '').trim();
      if (!name || !phone) {
        throw new Error('name and phone are required');
      }

      const student = {
        id: db.nextStudentId++,
        name,
        phone,
        gender: input.gender || '',
        birthday: input.birthday || '',
        className: input.className || '',
        enrolledAt: input.enrolledAt || '',
        status: 'active',
        archivedAt: null,
        remark: input.remark || ''
      };
      db.students.push(student);
      return student;
    },

    updateStudent(id, patch) {
      const student = db.students.find((item) => item.id === id);
      if (!student) throw new Error('student not found');
      student.name = patch.name ?? student.name;
      student.phone = patch.phone ?? student.phone;
      student.gender = patch.gender ?? student.gender;
      student.birthday = patch.birthday ?? student.birthday;
      student.className = patch.className ?? student.className;
      student.enrolledAt = patch.enrolledAt ?? student.enrolledAt;
      student.remark = patch.remark ?? student.remark;
      return student;
    },

    listStudents(filters = {}) {
      const page = Number(filters.page || 1);
      const pageSize = Number(filters.pageSize || db.students.length || 1);
      const items = db.students.filter((student) => {
        if (filters.status && student.status !== filters.status) return false;
        if (filters.keyword) {
          const text = `${student.name} ${student.phone}`;
          if (!text.includes(filters.keyword)) return false;
        }
        if (filters.className && student.className !== filters.className) return false;
        return true;
      });
      const start = (page - 1) * pageSize;

      return { items: items.slice(start, start + pageSize), total: items.length };
    },

    previewStudentImport(input = {}) {
      return previewStudentImport(db, input.text || input.csv || '');
    },

    importStudents(input = {}) {
      const preview = this.previewStudentImport(input);
      if (preview.invalidCount > 0) {
        const error = new Error('student import contains invalid rows');
        error.preview = preview;
        throw error;
      }
      const created = preview.rows.map((row) => this.createStudent(row.student));
      return { ...preview, created };
    },

    archiveStudent(id) {
      const student = db.students.find((item) => item.id === id);
      if (!student) throw new Error('student not found');
      student.status = 'archived';
      student.archivedAt = new Date().toISOString();
      return student;
    },

    addHomeworkRecord(input) {
      const studentId = requireExistingStudent(db, input.studentId).id;
      const submitStatus = normalizeEnum(input.submitStatus || 'pending', VALID_HOMEWORK_SUBMIT_STATUSES, 'invalid homework submit status');
      const record = {
        id: db.nextHomeworkId++,
        studentId,
        homeworkName: input.homeworkName || '',
        className: input.className || '',
        submitStatus,
        submitAt: input.submitAt || '',
        reviewResult: input.reviewResult || '',
        remark: input.remark || ''
      };
      db.homeworkRecords.push(record);
      return record;
    },

    updateHomeworkRecord(id, patch) {
      const record = db.homeworkRecords.find((item) => item.id === id);
      if (!record) throw new Error('homework record not found');
      if (patch.studentId !== undefined) {
        record.studentId = requireExistingStudent(db, patch.studentId).id;
      }
      record.homeworkName = patch.homeworkName ?? record.homeworkName;
      record.className = patch.className ?? record.className;
      record.submitStatus = patch.submitStatus === undefined
        ? record.submitStatus
        : normalizeEnum(patch.submitStatus, VALID_HOMEWORK_SUBMIT_STATUSES, 'invalid homework submit status');
      record.submitAt = patch.submitAt ?? record.submitAt;
      record.reviewResult = patch.reviewResult ?? record.reviewResult;
      record.remark = patch.remark ?? record.remark;
      return record;
    },

    listHomeworkRecords(filters = {}) {
      const items = db.homeworkRecords.filter((record) => {
        if (filters.studentId && record.studentId !== Number(filters.studentId)) return false;
        if (filters.className && record.className !== filters.className) return false;
        if (filters.submitStatus && record.submitStatus !== filters.submitStatus) return false;
        return true;
      });
      return { items, total: items.length };
    },

    addInterviewRecord(input) {
      const studentId = requireExistingStudent(db, input.studentId).id;
      const result = normalizeEnum(input.result || 'pending', VALID_INTERVIEW_RESULTS, 'invalid interview result');
      const hiredStatus = normalizeEnum(input.hiredStatus || 'pending', VALID_HIRED_STATUSES, 'invalid hired status');
      const record = {
        id: db.nextInterviewId++,
        studentId,
        companyName: input.companyName || '',
        positionName: input.positionName || '',
        interviewAt: input.interviewAt || '',
        result,
        feedback: input.feedback || '',
        hiredStatus,
        remark: input.remark || ''
      };
      db.interviewRecords.push(record);
      return record;
    },

    updateInterviewRecord(id, patch) {
      const record = db.interviewRecords.find((item) => item.id === id);
      if (!record) throw new Error('interview record not found');
      if (patch.studentId !== undefined) {
        record.studentId = requireExistingStudent(db, patch.studentId).id;
      }
      record.companyName = patch.companyName ?? record.companyName;
      record.positionName = patch.positionName ?? record.positionName;
      record.interviewAt = patch.interviewAt ?? record.interviewAt;
      record.result = patch.result === undefined
        ? record.result
        : normalizeEnum(patch.result, VALID_INTERVIEW_RESULTS, 'invalid interview result');
      record.feedback = patch.feedback ?? record.feedback;
      record.hiredStatus = patch.hiredStatus === undefined
        ? record.hiredStatus
        : normalizeEnum(patch.hiredStatus, VALID_HIRED_STATUSES, 'invalid hired status');
      record.remark = patch.remark ?? record.remark;
      return record;
    },

    listInterviewRecords(filters = {}) {
      const items = db.interviewRecords.filter((record) => {
        if (filters.studentId && record.studentId !== Number(filters.studentId)) return false;
        if (filters.companyName && !record.companyName.includes(filters.companyName)) return false;
        if (filters.result && record.result !== filters.result) return false;
        return true;
      });
      return { items, total: items.length };
    },

    createInterviewSchedule(input) {
      requireScheduleFields(input);
      const student = requireExistingStudent(db, input.studentId);
      const status = normalizeEnum(input.status || 'scheduled', VALID_SCHEDULE_STATUSES, 'invalid schedule status');

      const schedule = {
        id: db.nextInterviewScheduleId++,
        studentId: student.id,
        studentName: student.name,
        teacherId: normalizeRequiredId(input.teacherId, 'teacherId is required'),
        teacherName: input.teacherName,
        companyName: input.companyName || '',
        positionName: input.positionName || '',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status,
        requestSource: input.requestSource || '',
        confirmedByRole: input.confirmedByRole || '',
        confirmedByName: input.confirmedByName || '',
        confirmedAt: input.confirmedAt || '',
        remark: input.remark || ''
      };
      assertScheduleTime(schedule);
      assertNoScheduleConflict(db.interviewSchedules, schedule);
      db.interviewSchedules.push(schedule);
      return schedule;
    },

    approveInterviewSchedule(id, input = {}) {
      return confirmInterviewSchedule(db, id, input, 'admin');
    },

    acceptInterviewSchedule(id, input = {}) {
      return confirmInterviewSchedule(db, id, input, 'teacher');
    },

    rejectInterviewSchedule(id) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
      assertScheduleTransition(schedule, ['requested'], 'cancelled');
      schedule.status = 'cancelled';
      return schedule;
    },

    requestInterviewSchedule(input) {
      return this.createInterviewSchedule({ ...input, status: 'requested', requestSource: 'student' });
    },

    createAdminInterviewSchedule(input, session = {}) {
      return this.createInterviewSchedule({
        ...input,
        status: 'confirmed',
        requestSource: input.requestSource || 'admin',
        confirmedByRole: 'admin',
        confirmedByName: session.confirmedByName || session.username || '管理员',
        confirmedAt: input.confirmedAt || new Date().toISOString()
      });
    },
    updateInterviewSchedule(id, patch) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
      assertScheduleIsEditable(schedule);

      const nextSchedule = {
        ...schedule,
        studentId: patch.studentId ?? schedule.studentId,
        teacherId: patch.teacherId ?? schedule.teacherId,
        teacherName: patch.teacherName ?? schedule.teacherName,
        companyName: patch.companyName ?? schedule.companyName,
        positionName: patch.positionName ?? schedule.positionName,
        startsAt: patch.startsAt ?? schedule.startsAt,
        endsAt: patch.endsAt ?? schedule.endsAt,
        remark: patch.remark ?? schedule.remark
      };
      const student = requireExistingStudent(db, nextSchedule.studentId);
      nextSchedule.studentId = student.id;
      nextSchedule.teacherId = normalizeRequiredId(nextSchedule.teacherId, 'teacherId is required');
      nextSchedule.studentName = student.name;
      nextSchedule.status = patch.status === undefined
        ? (patch.startsAt || patch.endsAt ? 'rescheduled' : schedule.status)
        : normalizeEnum(patch.status, VALID_SCHEDULE_STATUSES, 'invalid schedule status');
      requireScheduleFields(nextSchedule);
      assertScheduleTime(nextSchedule);
      assertNoScheduleConflict(db.interviewSchedules, nextSchedule, id);
      Object.assign(schedule, nextSchedule);
      return schedule;
    },

    cancelInterviewSchedule(id) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
      assertScheduleTransition(schedule, ['requested', 'scheduled', 'confirmed', 'rescheduled'], 'cancelled');
      schedule.status = 'cancelled';
      return schedule;
    },

    completeInterviewSchedule(id) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
      assertScheduleTransition(schedule, ['scheduled', 'confirmed', 'rescheduled'], 'completed');
      schedule.status = 'completed';
      return schedule;
    },

    listInterviewSchedules(filters = {}) {
      const items = db.interviewSchedules.filter((schedule) => {
        if (filters.teacherId && schedule.teacherId !== Number(filters.teacherId)) return false;
        if (filters.studentId && schedule.studentId !== Number(filters.studentId)) return false;
        if (filters.status && schedule.status !== filters.status) return false;
        if (filters.from && schedule.endsAt <= filters.from) return false;
        if (filters.to && schedule.startsAt >= filters.to) return false;
        return true;
      });
      return { items, total: items.length };
    },

    listInterviewScheduleTimeline(filters = {}) {
      const days = buildWeek(filters.weekStart);
      const from = `${days[0]}T00:00:00`;
      const to = `${days[6]}T23:59:59`;
      const entries = this.listInterviewSchedules({ from, to }).items
        .filter((schedule) => !filters.teacherId || schedule.teacherId === Number(filters.teacherId))
        .filter((schedule) => schedule.status === 'confirmed')
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
      const teachers = [];

      for (const entry of entries) {
        let teacher = teachers.find((item) => item.teacherId === entry.teacherId);
        if (!teacher) {
          teacher = { teacherId: entry.teacherId, teacherName: entry.teacherName, entries: [] };
          teachers.push(teacher);
        }
        teacher.entries.push(entry);
      }

      return { weeks: days, teachers };
    },

    getStudentWorkspace(session) {
      if (!session?.studentId) throw new Error('student account not bound');
      const studentId = Number(session.studentId);
      const student = db.students.find((item) => item.id === studentId);
      if (!student) throw new Error('student not found');

      return {
        student,
        homeworkRecords: this.listHomeworkRecords({ studentId }).items,
        interviewRecords: this.listInterviewRecords({ studentId }).items,
        schedules: this.listInterviewSchedules({ studentId }).items
      };
    },

    getDashboardStats() {
      const active = db.students.filter((student) => student.status === 'active').length;
      const archived = db.students.filter((student) => student.status === 'archived').length;
      const completed = db.homeworkRecords.filter((record) => record.submitStatus === 'submitted').length;
      const hired = db.interviewRecords.filter((record) => record.hiredStatus === 'hired').length;
      const interviewTotal = db.interviewRecords.length;

      return {
        students: { active, archived, total: db.students.length },
        homework: { total: db.homeworkRecords.length, completed },
        interviews: { total: interviewTotal },
        employmentRate: interviewTotal === 0 ? 0 : Math.round((hired / interviewTotal) * 100)
      };
    },

    listTeachers() {
      return { items: teacherDirectory.map((teacher) => ({ ...teacher })), total: teacherDirectory.length };
    },

    login({ username, password }) {
      clearExpiredSessions(sessions);
      const normalizedUsername = String(username || '').trim();
      assertLoginAllowed(loginFailures, normalizedUsername);
      const account = accounts.find((item) => item.username === normalizedUsername);
      if (!account || account.password !== password) {
        recordLoginFailure(loginFailures, normalizedUsername);
        throw new Error('invalid credentials');
      }
      loginFailures.delete(normalizedUsername);
      const token = crypto.randomUUID();
      const session = {
        role: account.role,
        username: account.username,
        teacherId: account.teacherId || null,
        studentId: account.studentId || null,
        expiresAt: Date.now() + sessionMaxAgeMs
      };
      sessions.set(token, session);
      return { token, role: account.role };
    },

    getSession(token) {
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
      }
      return session;
    },

    logout(token) {
      if (!token) return;
      sessions.delete(token);
    },

    saveDatabase() {
      db.save();
    },

    exportStudents(filters = {}) {
      const students = this.listStudents(filters).items;
      const rows = [['姓名', '手机号', '性别', '班级/课程', '入学时间', '状态', '备注']];
      for (const student of students) {
        rows.push([student.name, student.phone, student.gender, student.className, student.enrolledAt, student.status, student.remark]);
      }
      return toCsvWithBom(rows);
    },

    exportHomeworkRecords(filters = {}) {
      const records = this.listHomeworkRecords(filters).items;
      const rows = [['作业名称', '学生ID', '班级/课程', '提交状态', '提交时间', '批改结果', '备注']];
      for (const record of records) {
        rows.push([record.homeworkName, record.studentId, record.className, record.submitStatus, record.submitAt, record.reviewResult, record.remark]);
      }
      return toCsvWithBom(rows);
    },

    exportInterviewRecords(filters = {}) {
      const records = this.listInterviewRecords(filters).items;
      const rows = [['公司', '岗位', '学生ID', '面试时间', '结果', '反馈', '入职状态', '备注']];
      for (const record of records) {
        rows.push([record.companyName, record.positionName, record.studentId, record.interviewAt, record.result, record.feedback, record.hiredStatus, record.remark]);
      }
      return toCsvWithBom(rows);
    }
  };
}

function normalizeAuthAccounts(authAccounts) {
  if (!Array.isArray(authAccounts) || authAccounts.length === 0) {
    throw new Error('auth accounts are required');
  }

  return authAccounts.map((account) => {
    const username = String(account.username || '').trim();
    const password = String(account.password || '');
    const role = String(account.role || '').trim();

    if (!username || !password || !VALID_ROLES.has(role)) {
      throw new Error('invalid auth account config');
    }

    return {
      username,
      password,
      role,
      teacherId: account.teacherId ? Number(account.teacherId) : null,
      studentId: account.studentId ? Number(account.studentId) : null
    };
  });
}

function normalizeTeachers(teachers) {
  const normalized = Array.isArray(teachers) ? teachers : [];
  return normalized.map((teacher) => ({
    id: normalizeRequiredId(teacher.id, 'teacher id is required'),
    name: String(teacher.name || '').trim() || `老师${teacher.id}`
  }));
}

function clearExpiredSessions(sessions) {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function confirmInterviewSchedule(db, id, input, confirmedByRole) {
  const schedule = db.interviewSchedules.find((item) => item.id === id);
  if (!schedule) throw new Error('schedule not found');
  assertScheduleTransition(schedule, ['requested'], 'confirmed');
  schedule.status = 'confirmed';
  schedule.confirmedByRole = confirmedByRole;
  schedule.confirmedByName = input.approverName || input.confirmedByName || '';
  schedule.confirmedAt = input.confirmedAt || new Date().toISOString();
  return schedule;
}

function requireScheduleFields(input) {
  if (!input.studentId || !input.teacherId || !input.teacherName || !input.startsAt || !input.endsAt) {
    throw new Error('schedule fields are required');
  }
}

function assertScheduleTime(schedule) {
  if (!schedule.startsAt || !schedule.endsAt || schedule.startsAt >= schedule.endsAt) {
    throw new Error('invalid schedule time');
  }
}

function assertNoScheduleConflict(schedules, candidate, ignoreId) {
  for (const schedule of schedules) {
    if (schedule.id === ignoreId || schedule.status === 'cancelled') continue;
    if (!isOverlapping(candidate, schedule)) continue;
    if (schedule.teacherId === candidate.teacherId) throw new Error('teacher conflict');
    if (schedule.studentId === candidate.studentId) throw new Error('student conflict');
  }
}

function assertScheduleTransition(schedule, allowedCurrentStatuses, nextStatus) {
  if (allowedCurrentStatuses.includes(schedule.status)) return;
  throw new Error(`invalid schedule transition: ${schedule.status} -> ${nextStatus}`);
}

function assertScheduleIsEditable(schedule) {
  if (!TERMINAL_SCHEDULE_STATUSES.has(schedule.status)) return;
  throw new Error(`invalid schedule transition: ${schedule.status} -> rescheduled`);
}

function isOverlapping(left, right) {
  return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
}

function buildWeek(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function toCsvWithBom(rows) {
  return `\ufeff${toCsv(rows)}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function requireExistingStudent(db, value) {
  const studentId = normalizeRequiredId(value, 'studentId is required');
  const student = db.students.find((item) => item.id === studentId);
  if (!student) throw new Error('student not found');
  return student;
}

function normalizeRequiredId(value, message) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(message);
  return id;
}

function normalizeEnum(value, validValues, message) {
  const normalized = String(value || '').trim();
  if (!validValues.has(normalized)) throw new Error(message);
  return normalized;
}

function assertLoginAllowed(loginFailures, username) {
  const key = username || '<empty>';
  const current = loginFailures.get(key);
  if (!current) return;
  if (current.lockUntil && current.lockUntil > Date.now()) {
    throw createCodedError('too many login attempts', 'LOGIN_RATE_LIMITED');
  }
  if (current.lockUntil && current.lockUntil <= Date.now()) {
    loginFailures.delete(key);
  }
}

function recordLoginFailure(loginFailures, username) {
  const key = username || '<empty>';
  const current = loginFailures.get(key) || { count: 0, lockUntil: 0 };
  const next = { count: current.count + 1, lockUntil: current.lockUntil || 0 };
  if (next.count >= MAX_LOGIN_FAILURES) {
    next.lockUntil = Date.now() + LOGIN_LOCK_MS;
  }
  loginFailures.set(key, next);
}

function createCodedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function previewStudentImport(db, text) {
  const rows = parseCsv(text);
  const { dataRows, header } = splitImportHeader(rows);
  const existingPhones = new Set(db.students.map((student) => student.phone).filter(Boolean));
  const seenPhones = new Set();
  const previewRows = dataRows.map((cells, index) => {
    const student = readStudentImportRow(cells, header);
    const errors = [];

    if (!student.name) errors.push('姓名不能为空');
    if (!student.phone) errors.push('手机号不能为空');
    if (student.phone && (existingPhones.has(student.phone) || seenPhones.has(student.phone))) {
      errors.push('手机号重复');
    }
    if (student.phone && !seenPhones.has(student.phone)) {
      seenPhones.add(student.phone);
    }

    return {
      rowNumber: header ? index + 2 : index + 1,
      student,
      errors
    };
  });

  return {
    rows: previewRows,
    validCount: previewRows.filter((row) => row.errors.length === 0).length,
    invalidCount: previewRows.filter((row) => row.errors.length > 0).length
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\ufeff/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell.trim());
  rows.push(row);
  return rows.filter((items) => items.some((item) => item));
}

function splitImportHeader(rows) {
  if (!rows.length) return { dataRows: [], header: null };
  const firstRow = rows[0].map((cell) => cell.trim());
  const hasHeader = firstRow.some((cell) => ['姓名', 'name', '手机号', 'phone'].includes(cell));
  if (!hasHeader) return { dataRows: rows, header: null };

  const header = {};
  firstRow.forEach((cell, index) => {
    const key = normalizeImportHeader(cell);
    if (key) header[key] = index;
  });
  return { dataRows: rows.slice(1), header };
}

function normalizeImportHeader(cell) {
  const text = String(cell || '').trim();
  const aliases = {
    name: ['姓名', 'name'],
    phone: ['手机号', '手机', '电话', 'phone'],
    gender: ['性别', 'gender'],
    birthday: ['生日', 'birthday'],
    className: ['班级/课程', '班级', '课程', 'className'],
    enrolledAt: ['入学时间', '入学日期', 'enrolledAt'],
    remark: ['备注', 'remark']
  };
  return Object.keys(aliases).find((key) => aliases[key].includes(text)) || null;
}

function readStudentImportRow(cells, header) {
  const byHeader = (key) => {
    if (!header || header[key] === undefined) return '';
    return cells[header[key]] || '';
  };
  const byIndex = (index) => cells[index] || '';

  return {
    name: header ? byHeader('name') : byIndex(0),
    phone: header ? byHeader('phone') : byIndex(1),
    gender: header ? byHeader('gender') : byIndex(2),
    birthday: header ? byHeader('birthday') : byIndex(3),
    className: header ? byHeader('className') : byIndex(4),
    enrolledAt: header ? byHeader('enrolledAt') : byIndex(5),
    remark: header ? byHeader('remark') : byIndex(6)
  };
}

module.exports = {
  createApp: createAppWithOptions,
  DEFAULT_AUTH_ACCOUNTS,
  DEFAULT_TEACHERS,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  normalizeAuthAccounts
};
