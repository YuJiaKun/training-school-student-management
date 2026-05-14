const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { toCsvWithBom } = require('./lib/csv');
const { generateInitialPassword, hashPassword, verifyPassword } = require('./lib/passwords');
const { createZip } = require('./lib/zip');

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
const ALLOWED_HOMEWORK_FILE_EXTENSIONS = new Set(['.txt']);
const DEFAULT_HOMEWORK_MAX_FILE_BYTES = 20 * 1024 * 1024;
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
  sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
  uploadRoot = defaultUploadRoot(db),
  homeworkMaxFileBytes = DEFAULT_HOMEWORK_MAX_FILE_BYTES
}) {
  const sessions = new Map();
  const loginFailures = new Map();
  const baseAuthAccounts = normalizeAuthAccounts(authAccounts);
  db.authAccounts = Array.isArray(db.authAccounts) && db.authAccounts.length
    ? normalizeAuthAccounts(db.authAccounts)
    : [];
  if (!Number.isInteger(db.nextAuthAccountId)) db.nextAuthAccountId = nextRuntimeId(db.authAccounts);
  const teacherDirectory = normalizeTeachers(teachers);
  const sessionMaxAgeMs = Number(sessionMaxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS) * 1000;
  const maxHomeworkFileBytes = Number(homeworkMaxFileBytes || DEFAULT_HOMEWORK_MAX_FILE_BYTES);

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
      const accountDirectory = listAllAuthAccounts(baseAuthAccounts, db);
      const items = db.students.filter((student) => {
        if (filters.status && student.status !== filters.status) return false;
        if (filters.keyword) {
          const text = `${student.name} ${student.phone}`;
          if (!text.includes(filters.keyword)) return false;
        }
        if (filters.className && student.className !== filters.className) return false;
        if (filters.accountStatus) {
          const hasAccount = Boolean(findStudentAccount(accountDirectory, student.id));
          if (filters.accountStatus === 'generated' && !hasAccount) return false;
          if (filters.accountStatus === 'missing' && hasAccount) return false;
        }
        return true;
      }).map((student) => withStudentAccountInfo(student, accountDirectory));
      const start = (page - 1) * pageSize;

      return { items: items.slice(start, start + pageSize), total: items.length };
    },

    exportStudentImportTemplate() {
      return toCsvWithBom([['姓名', '手机号', '性别', '出生日期', '班级/课程', '入学日期', '备注']]);
    },

    previewStudentImport(input = {}) {
      return previewStudentImport(db, input.text || input.csv || '');
    },

    importStudents(input = {}) {
      const preview = this.previewStudentImport(input);
      if (preview.validCount === 0) {
        const error = new Error('student import contains invalid rows');
        error.preview = preview;
        throw error;
      }
      const created = preview.rows
        .filter((row) => row.errors.length === 0)
        .map((row) => this.createStudent(row.student));
      const accountResult = input.generateAccounts
        ? this.generateStudentAccounts({ studentIds: created.map((student) => student.id) })
        : { accounts: [], skipped: [], skippedCount: 0 };
      return { ...preview, created, ...accountResult };
    },

    exportInvalidStudentImportRows(input = {}) {
      const preview = this.previewStudentImport(input);
      const rows = [['行号', '姓名', '手机号', '班级/课程', '错误原因']];
      for (const row of preview.rows.filter((item) => item.errors.length > 0)) {
        rows.push([
          row.rowNumber,
          row.student.name,
          row.student.phone,
          row.student.className,
          row.errors.join('；')
        ]);
      }
      return toCsvWithBom(rows);
    },

    generateStudentAccounts(input = {}) {
      const students = resolveAccountGenerationStudents(db, input);
      const usedUsernames = new Set(listAllAuthAccounts(baseAuthAccounts, db).map((account) => account.username));
      const existingStudentIds = new Set(listAllAuthAccounts(baseAuthAccounts, db)
        .filter((account) => account.role === 'student' && account.status !== 'disabled' && account.studentId)
        .map((account) => Number(account.studentId)));
      const accounts = [];
      const skipped = [];

      for (const student of students) {
        if (existingStudentIds.has(Number(student.id))) {
          skipped.push({ studentId: student.id, reason: '已有账号' });
          continue;
        }

        const username = uniqueStudentUsername(student, usedUsernames);
        usedUsernames.add(username);
        existingStudentIds.add(Number(student.id));
        const initialPassword = generateInitialPassword();
        const account = {
          id: db.nextAuthAccountId++,
          username,
          password: '',
          passwordHash: hashPassword(initialPassword),
          role: 'student',
          studentId: student.id,
          teacherId: null,
          status: 'active',
          createdAt: new Date().toISOString(),
          passwordUpdatedAt: new Date().toISOString()
        };
        db.authAccounts.push(account);
        accounts.push(publicStudentAccount(db, account, { initialPassword }));
      }

      return { accounts, skipped, skippedCount: skipped.length };
    },

    resetStudentAccountPasswords(input = {}) {
      const students = resolveAccountGenerationStudents(db, input);
      const accountDirectory = listAllAuthAccounts(baseAuthAccounts, db);
      const accounts = [];
      const skipped = [];

      for (const student of students) {
        const account = findStudentAccount(accountDirectory, student.id);
        if (!account) {
          skipped.push({ studentId: student.id, reason: '未生成账号' });
          continue;
        }

        const initialPassword = generateInitialPassword();
        account.password = '';
        account.passwordHash = hashPassword(initialPassword);
        account.passwordUpdatedAt = new Date().toISOString();
        accounts.push(publicStudentAccount(db, account, { initialPassword }));
      }

      return { accounts, skipped, skippedCount: skipped.length };
    },

    archiveStudent(id) {
      const student = db.students.find((item) => item.id === id);
      if (!student) throw new Error('student not found');
      student.status = 'archived';
      student.archivedAt = new Date().toISOString();
      return student;
    },

    createHomeworkAssignment(input = {}, session = {}) {
      const homeworkName = String(input.homeworkName || '').trim();
      const className = String(input.className || '').trim();
      if (!homeworkName || !className) {
        throw new Error('homework name and class are required');
      }

      const assignment = {
        id: db.nextHomeworkAssignmentId++,
        homeworkName,
        className,
        dueDate: input.dueDate || '',
        description: input.description || '',
        createdAt: input.createdAt || new Date().toISOString(),
        createdByRole: session.role || input.createdByRole || '',
        createdByName: session.username || input.createdByName || ''
      };
      db.homeworkAssignments.push(assignment);

      const records = db.students
        .filter((student) => student.status === 'active')
        .filter((student) => student.className === className)
        .map((student) => this.addHomeworkRecord({
          assignmentId: assignment.id,
          studentId: student.id,
          homeworkName,
          className,
          dueDate: assignment.dueDate,
          description: assignment.description,
          submitStatus: 'pending'
        }));

      return { assignment: { ...assignment }, records };
    },

    listHomeworkAssignments(filters = {}) {
      const items = db.homeworkAssignments
        .filter((assignment) => {
          if (filters.className && assignment.className !== filters.className) return false;
          if (filters.keyword && !assignment.homeworkName.includes(filters.keyword)) return false;
          return true;
        })
        .map((assignment) => withHomeworkAssignmentStats(db, assignment))
        .sort((left, right) => right.id - left.id);
      return { items, total: items.length };
    },

    addHomeworkRecord(input) {
      const studentId = requireExistingStudent(db, input.studentId).id;
      const submitStatus = normalizeEnum(input.submitStatus || 'pending', VALID_HOMEWORK_SUBMIT_STATUSES, 'invalid homework submit status');
      const record = {
        id: db.nextHomeworkId++,
        assignmentId: input.assignmentId ? Number(input.assignmentId) : null,
        studentId,
        homeworkName: input.homeworkName || '',
        className: input.className || '',
        dueDate: input.dueDate || '',
        description: input.description || '',
        submitStatus,
        submitAt: input.submitAt || '',
        reviewResult: input.reviewResult || '',
        remark: input.remark || '',
        fileName: input.fileName || '',
        filePath: input.filePath || '',
        fileSize: input.fileSize || 0,
        fileType: input.fileType || ''
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
      record.dueDate = patch.dueDate ?? record.dueDate;
      record.description = patch.description ?? record.description;
      record.submitStatus = patch.submitStatus === undefined
        ? record.submitStatus
        : normalizeEnum(patch.submitStatus, VALID_HOMEWORK_SUBMIT_STATUSES, 'invalid homework submit status');
      record.submitAt = patch.submitAt ?? record.submitAt;
      record.reviewResult = patch.reviewResult ?? record.reviewResult;
      record.remark = patch.remark ?? record.remark;
      record.fileName = patch.fileName ?? record.fileName;
      record.filePath = patch.filePath ?? record.filePath;
      record.fileSize = patch.fileSize ?? record.fileSize;
      record.fileType = patch.fileType ?? record.fileType;
      return record;
    },

    listHomeworkRecords(filters = {}) {
      const items = db.homeworkRecords.filter((record) => {
        const student = db.students.find((item) => item.id === record.studentId);
        if (filters.studentId && record.studentId !== Number(filters.studentId)) return false;
        if (filters.assignmentId && Number(record.assignmentId) !== Number(filters.assignmentId)) return false;
        if (filters.className && record.className !== filters.className) return false;
        if (filters.submitStatus === 'submitted' && !isHomeworkSubmittedStatus(record.submitStatus)) return false;
        if (filters.submitStatus && filters.submitStatus !== 'submitted' && record.submitStatus !== filters.submitStatus) return false;
        if (filters.keyword) {
          const text = `${record.homeworkName} ${record.className} ${student?.name || ''} ${student?.phone || ''}`;
          if (!text.includes(filters.keyword)) return false;
        }
        return true;
      }).map((record) => withHomeworkStudent(db, record));
      return { items, total: items.length };
    },

    submitHomeworkFile(id, input = {}) {
      const record = db.homeworkRecords.find((item) => item.id === Number(id));
      if (!record) throw new Error('homework record not found');
      if (input.studentId !== undefined && Number(input.studentId) !== Number(record.studentId)) {
        throw createHttpError('forbidden', 403);
      }

      const fileName = String(input.fileName || '').trim();
      const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content || '');
      assertAllowedHomeworkFile(fileName, content, maxHomeworkFileBytes);

      const assignmentId = record.assignmentId || 'legacy';
      const targetDir = path.join(uploadRoot, 'homework', String(assignmentId));
      const safeName = sanitizeFileName(fileName);
      const storedName = `${record.id}-${Date.now()}-${safeName}`;
      const filePath = path.join(targetDir, storedName);
      fs.mkdirSync(targetDir, { recursive: true });
      removeStoredHomeworkFile(record, uploadRoot);
      fs.writeFileSync(filePath, content);

      record.submitStatus = 'submitted';
      record.submitAt = input.submittedAt || new Date().toISOString();
      record.remark = input.remark ?? record.remark;
      record.fileName = fileName;
      record.filePath = filePath;
      record.fileSize = content.length;
      record.fileType = inferHomeworkFileType(fileName) || input.contentType || 'application/octet-stream';
      return withHomeworkStudent(db, record);
    },

    getHomeworkFile(id, session = {}) {
      const record = db.homeworkRecords.find((item) => item.id === Number(id));
      if (!record) throw new Error('homework record not found');
      if (session.role === 'student' && Number(session.studentId) !== Number(record.studentId)) {
        throw createHttpError('forbidden', 403);
      }
      if (!record.filePath || !fs.existsSync(record.filePath)) {
        throw createHttpError('homework file not found', 404);
      }
      return {
        fileName: record.fileName || path.basename(record.filePath),
        contentType: record.fileType || inferHomeworkFileType(record.fileName),
        body: fs.readFileSync(record.filePath)
      };
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
      const completed = db.homeworkRecords.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
      const hired = db.interviewRecords.filter((record) => record.hiredStatus === 'hired').length;
      const interviewTotal = db.interviewRecords.length;

      return {
        students: { active, archived, total: db.students.length },
        homework: { total: db.homeworkRecords.length, completed },
        interviews: { total: interviewTotal },
        employmentRate: interviewTotal === 0 ? 0 : Math.round((hired / interviewTotal) * 100)
      };
    },

    getHomeworkAnalytics(filters = {}) {
      return buildHomeworkAnalytics(db, filters);
    },

    listTeachers() {
      return { items: teacherDirectory.map((teacher) => ({ ...teacher })), total: teacherDirectory.length };
    },

    listClasses() {
      const classes = new Map();
      for (const student of db.students) {
        if (student.status !== 'active' || !student.className) continue;
        classes.set(student.className, (classes.get(student.className) || 0) + 1);
      }
      const items = Array.from(classes.entries())
        .map(([className, studentCount]) => ({ className, studentCount }))
        .sort((left, right) => left.className.localeCompare(right.className, 'zh-CN'));
      return { items, total: items.length };
    },

    login({ username, password }) {
      clearExpiredSessions(sessions);
      const normalizedUsername = String(username || '').trim();
      assertLoginAllowed(loginFailures, normalizedUsername);
      const account = listAllAuthAccounts(baseAuthAccounts, db).find((item) => item.username === normalizedUsername);
      if (!account || !verifyAccountPassword(account, password)) {
        recordLoginFailure(loginFailures, normalizedUsername);
        throw new Error('invalid credentials');
      }
      if (upgradeLegacyAccountPassword(account, password)) {
        db.save();
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

    exportStudentAccounts(filters = {}) {
      const students = this.listStudents(filters).items;
      const accountDirectory = listAllAuthAccounts(baseAuthAccounts, db);
      const rows = [['学生姓名', '班级/课程', '手机号', '用户名', '账号状态', '创建时间']];
      for (const student of students) {
        const account = findStudentAccount(accountDirectory, student.id);
        if (!account) continue;
        rows.push([student.name, student.className, student.phone, account.username, accountStatusLabel(account.status), account.createdAt || '']);
      }
      return toCsvWithBom(rows);
    },

    exportHomeworkRecords(filters = {}) {
      const records = this.listHomeworkRecords(filters).items;
      const rows = [['作业名称', '学生姓名', '手机号', '班级/课程', '提交状态', '提交时间', '文件名', '备注']];
      for (const record of records) {
        rows.push([record.homeworkName, record.studentName || `#${record.studentId}`, record.studentPhone || '', record.className, statusLabel(record.submitStatus), record.submitAt, record.fileName || '', record.remark]);
      }
      return toCsvWithBom(rows);
    },

    exportHomeworkAssignmentZip(assignmentId) {
      const assignment = db.homeworkAssignments.find((item) => item.id === Number(assignmentId));
      if (!assignment) throw new Error('homework assignment not found');
      const records = this.listHomeworkRecords({ assignmentId }).items;
      const rows = [['作业名称', '班级/课程', '学生姓名', '手机号', '提交状态', '提交时间', '文件名', '备注']];
      const entries = [];

      for (const record of records) {
        rows.push([
          record.homeworkName,
          record.className,
          record.studentName || `#${record.studentId}`,
          record.studentPhone || '',
          statusLabel(record.submitStatus),
          record.submitAt || '',
          record.fileName || '',
          record.remark || ''
        ]);

        if (record.filePath && fs.existsSync(record.filePath)) {
          const studentName = sanitizeFileName(record.studentName || `学生${record.studentId}`);
          const fileName = sanitizeFileName(record.fileName || path.basename(record.filePath));
          entries.push({
            name: `提交文件/${studentName}-${record.studentId}-${fileName}`,
            data: fs.readFileSync(record.filePath)
          });
        }
      }

      entries.unshift({ name: '提交清单.csv', data: Buffer.from(toCsvWithBom(rows), 'utf8') });

      return {
        fileName: `${sanitizeFileName(assignment.homeworkName)}-作业提交.zip`,
        contentType: 'application/zip',
        body: createZip(entries)
      };
    },

    exportHomeworkStudentZip(studentId, filters = {}) {
      const student = requireExistingStudent(db, studentId);
      const records = this.listHomeworkRecords({
        studentId: student.id,
        assignmentId: filters.assignmentId,
        className: filters.className
      }).items;
      const rows = [['作业名称', '班级/课程', '学生姓名', '手机号', '提交状态', '提交时间', '文件名', '备注']];
      const entries = [];

      for (const record of records) {
        rows.push([
          record.homeworkName,
          record.className,
          record.studentName || student.name || `#${record.studentId}`,
          record.studentPhone || student.phone || '',
          statusLabel(record.submitStatus),
          record.submitAt || '',
          record.fileName || '',
          record.remark || ''
        ]);

        if (record.filePath && fs.existsSync(record.filePath)) {
          const homeworkName = sanitizeFileName(record.homeworkName || `作业${record.id}`);
          const fileName = sanitizeFileName(record.fileName || path.basename(record.filePath));
          entries.push({
            name: `提交文件/${homeworkName}-${student.id}-${fileName}`,
            data: fs.readFileSync(record.filePath)
          });
        }
      }

      entries.unshift({ name: '提交清单.csv', data: Buffer.from(toCsvWithBom(rows), 'utf8') });

      return {
        fileName: `${sanitizeFileName(student.name || `学生${student.id}`)}-作业提交.zip`,
        contentType: 'application/zip',
        body: createZip(entries)
      };
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
    const passwordHash = String(account.passwordHash || '');
    const role = String(account.role || '').trim();

    if (!username || (!password && !passwordHash) || !VALID_ROLES.has(role)) {
      throw new Error('invalid auth account config');
    }

    return {
      id: account.id ? Number(account.id) : null,
      username,
      password,
      passwordHash,
      role,
      teacherId: account.teacherId ? Number(account.teacherId) : null,
      studentId: account.studentId ? Number(account.studentId) : null,
      status: account.status || 'active',
      createdAt: account.createdAt || '',
      passwordUpdatedAt: account.passwordUpdatedAt || ''
    };
  });
}

function listAllAuthAccounts(baseAuthAccounts, db) {
  const storedAccounts = Array.isArray(db.authAccounts) ? db.authAccounts : [];
  return [
    ...baseAuthAccounts,
    ...storedAccounts
  ].filter((account) => account.status !== 'disabled');
}

function nextRuntimeId(records) {
  const maxId = (records || []).reduce((max, record) => {
    const id = Number(record.id);
    return Number.isInteger(id) && id > max ? id : max;
  }, 0);
  return maxId + 1;
}

function withStudentAccountInfo(student, accountDirectory) {
  const account = accountDirectory.find((item) => item.role === 'student' && Number(item.studentId) === Number(student.id));
  return {
    ...student,
    hasAccount: Boolean(account),
    accountUsername: account?.username || ''
  };
}

function findStudentAccount(accountDirectory, studentId) {
  return (accountDirectory || [])
    .filter((account) => account.role === 'student' && account.status !== 'disabled')
    .find((account) => Number(account.studentId) === Number(studentId));
}

function resolveAccountGenerationStudents(db, input = {}) {
  const requestedIds = Array.isArray(input.studentIds)
    ? new Set(input.studentIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    : null;
  const filters = input.filters || {};

  return db.students
    .filter((student) => student.status === 'active')
    .filter((student) => !requestedIds || requestedIds.has(Number(student.id)))
    .filter((student) => !filters.status || student.status === filters.status)
    .filter((student) => !filters.className || student.className === filters.className)
    .filter((student) => {
      if (!filters.keyword) return true;
      return `${student.name} ${student.phone}`.includes(filters.keyword);
    });
}

function uniqueStudentUsername(student, usedUsernames) {
  const rawBase = String(student.phone || '').replace(/\D/g, '') || `student${student.id}`;
  let username = rawBase;
  let suffix = 1;
  while (usedUsernames.has(username)) {
    username = `${rawBase}-${suffix}`;
    suffix += 1;
  }
  return username;
}

function publicStudentAccount(db, account, options = {}) {
  const student = db.students.find((item) => Number(item.id) === Number(account.studentId));
  const payload = {
    id: account.id,
    username: account.username,
    role: account.role,
    studentId: account.studentId,
    studentName: student?.name || '',
    studentPhone: student?.phone || '',
    className: student?.className || '',
    createdAt: account.createdAt || ''
  };
  if (options.initialPassword) payload.initialPassword = options.initialPassword;
  return payload;
}

function verifyAccountPassword(account, password) {
  if (account.passwordHash) {
    return verifyPassword(password, account.passwordHash);
  }
  return Boolean(account.password) && account.password === String(password || '');
}

function upgradeLegacyAccountPassword(account, password) {
  if (account.passwordHash || !account.password) return false;
  account.passwordHash = hashPassword(password);
  account.password = '';
  account.passwordUpdatedAt = new Date().toISOString();
  return true;
}

function accountStatusLabel(status) {
  if (status === 'disabled') return '已停用';
  return '正常';
}

function defaultUploadRoot(db) {
  if (db?.filePath) {
    return path.join(path.dirname(db.filePath), 'uploads');
  }
  return path.join(process.cwd(), 'data', 'uploads');
}

function normalizeTeachers(teachers) {
  const normalized = Array.isArray(teachers) ? teachers : [];
  return normalized.map((teacher) => ({
    id: normalizeRequiredId(teacher.id, 'teacher id is required'),
    name: String(teacher.name || '').trim() || `老师${teacher.id}`
  }));
}

function withHomeworkAssignmentStats(db, assignment) {
  const records = db.homeworkRecords.filter((record) => Number(record.assignmentId) === Number(assignment.id));
  const submittedCount = records.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
  const totalCount = records.length;
  return {
    ...assignment,
    totalCount,
    submittedCount,
    pendingCount: totalCount - submittedCount
  };
}

function isHomeworkSubmittedStatus(status) {
  return status === 'submitted' || status === 'reviewed';
}

function buildHomeworkAnalytics(db, filters = {}) {
  const className = String(filters.className || '').trim();
  const activeStudents = db.students.filter((student) => student.status === 'active');
  const students = className ? activeStudents.filter((student) => student.className === className) : activeStudents;
  const assignments = db.homeworkAssignments
    .filter((assignment) => !className || assignment.className === className)
    .slice()
    .sort((left, right) => right.id - left.id);
  const records = db.homeworkRecords.filter((record) => {
    if (className && record.className !== className) return false;
    return true;
  });
  const latestAssignment = assignments[0] || null;

  return {
    overview: buildHomeworkOverview(students, assignments, records),
    classes: buildHomeworkClassAnalytics(activeStudents, db.homeworkAssignments, db.homeworkRecords, className),
    assignments: assignments.map((assignment) => {
      const assignmentRecords = records.filter((record) => Number(record.assignmentId) === Number(assignment.id));
      return {
        id: assignment.id,
        homeworkName: assignment.homeworkName,
        className: assignment.className,
        dueDate: assignment.dueDate || '',
        createdAt: assignment.createdAt || '',
        ...completionStats(assignmentRecords)
      };
    }),
    students: students.map((student) => {
      const studentRecords = records.filter((record) => Number(record.studentId) === Number(student.id));
      const latestSubmitAt = studentRecords
        .filter((record) => isHomeworkSubmittedStatus(record.submitStatus) && record.submitAt)
        .map((record) => record.submitAt)
        .sort()
        .at(-1) || '';
      return {
        studentId: student.id,
        studentName: student.name || '',
        studentPhone: student.phone || '',
        className: student.className || '',
        assignedCount: studentRecords.length,
        submittedCount: studentRecords.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length,
        pendingCount: studentRecords.filter((record) => !isHomeworkSubmittedStatus(record.submitStatus)).length,
        completionRate: percentage(studentRecords.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length, studentRecords.length),
        latestSubmitAt
      };
    }).sort((left, right) => {
      if (left.completionRate !== right.completionRate) return left.completionRate - right.completionRate;
      return left.studentId - right.studentId;
    }),
    latestAssignment: latestAssignment ? buildLatestHomeworkAssignment(db, latestAssignment, records) : null
  };
}

function buildHomeworkOverview(students, assignments, records) {
  const submittedCount = records.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
  return {
    studentCount: students.length,
    assignmentCount: assignments.length,
    recordCount: records.length,
    submittedCount,
    pendingCount: records.length - submittedCount,
    completionRate: percentage(submittedCount, records.length)
  };
}

function buildHomeworkClassAnalytics(students, assignments, records, selectedClassName = '') {
  const classNames = new Set();
  for (const student of students) {
    if (student.className) classNames.add(student.className);
  }
  for (const assignment of assignments) {
    if (assignment.className) classNames.add(assignment.className);
  }
  for (const record of records) {
    if (record.className) classNames.add(record.className);
  }

  return Array.from(classNames)
    .filter((className) => !selectedClassName || className === selectedClassName)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((className) => {
      const classRecords = records.filter((record) => record.className === className);
      const submittedCount = classRecords.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
      return {
        className,
        studentCount: students.filter((student) => student.className === className).length,
        assignmentCount: assignments.filter((assignment) => assignment.className === className).length,
        recordCount: classRecords.length,
        submittedCount,
        pendingCount: classRecords.length - submittedCount,
        completionRate: percentage(submittedCount, classRecords.length)
      };
    });
}

function buildLatestHomeworkAssignment(db, assignment, records) {
  const assignmentRecords = records.filter((record) => Number(record.assignmentId) === Number(assignment.id));
  return {
    id: assignment.id,
    homeworkName: assignment.homeworkName,
    className: assignment.className,
    dueDate: assignment.dueDate || '',
    createdAt: assignment.createdAt || '',
    ...completionStats(assignmentRecords),
    missingStudents: assignmentRecords
      .filter((record) => !isHomeworkSubmittedStatus(record.submitStatus))
      .map((record) => ({
        studentId: record.studentId,
        studentName: db.students.find((student) => Number(student.id) === Number(record.studentId))?.name || `#${record.studentId}`,
        studentPhone: db.students.find((student) => Number(student.id) === Number(record.studentId))?.phone || '',
        className: record.className || ''
      }))
  };
}

function completionStats(records) {
  const submittedCount = records.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
  return {
    totalCount: records.length,
    submittedCount,
    pendingCount: records.length - submittedCount,
    completionRate: percentage(submittedCount, records.length)
  };
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function withHomeworkStudent(db, record) {
  const student = db.students.find((item) => item.id === record.studentId);
  return {
    ...record,
    studentName: student?.name || '',
    studentPhone: student?.phone || ''
  };
}

function clearExpiredSessions(sessions) {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function assertAllowedHomeworkFile(fileName, content, maxBytes) {
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_HOMEWORK_FILE_EXTENSIONS.has(extension)) {
    throw new Error('unsupported homework file type');
  }
  if (!content.length) {
    throw new Error('homework file is required');
  }
  if (content.length > maxBytes) {
    throw createHttpError('homework file too large', 413);
  }
}

function inferHomeworkFileType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const types = {
    '.txt': 'text/plain; charset=utf-8'
  };
  return types[extension] || 'application/octet-stream';
}

function sanitizeFileName(fileName) {
  const text = String(fileName || '').trim() || '未命名';
  return text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
}

function removeStoredHomeworkFile(record, uploadRoot) {
  if (!record.filePath) return;
  const resolvedFile = path.resolve(record.filePath);
  const resolvedRoot = path.resolve(uploadRoot);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) return;
  if (fs.existsSync(resolvedFile)) {
    fs.unlinkSync(resolvedFile);
  }
}

function statusLabel(status) {
  const labels = {
    pending: '待提交',
    submitted: '已提交',
    reviewed: '已提交'
  };
  return labels[status] || status || '';
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

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
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
