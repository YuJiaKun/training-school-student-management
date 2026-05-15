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
const ALLOWED_TRANSCRIPT_FILE_EXTENSIONS = new Set(['.txt']);
const DEFAULT_HOMEWORK_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TRANSCRIPT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const VALID_INTERVIEW_RESULTS = new Set(['pending', 'passed', 'failed']);
const VALID_HIRED_STATUSES = new Set(['pending', 'hired', 'not_hired']);
const VALID_SCHEDULE_STATUSES = new Set(['requested', 'scheduled', 'confirmed', 'rescheduled', 'completed', 'cancelled']);
const TERMINAL_SCHEDULE_STATUSES = new Set(['completed', 'cancelled']);
const UNFINISHED_SCHEDULE_STATUSES = new Set(['requested', 'scheduled', 'confirmed', 'rescheduled']);
const MAX_UNFINISHED_STUDENT_SCHEDULES = 3;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

function createAppWithOptions({
  db,
  authAccounts = DEFAULT_AUTH_ACCOUNTS,
  teachers = DEFAULT_TEACHERS,
  sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
  uploadRoot = defaultUploadRoot(db),
  homeworkMaxFileBytes = DEFAULT_HOMEWORK_MAX_FILE_BYTES,
  transcriptMaxFileBytes = DEFAULT_TRANSCRIPT_MAX_FILE_BYTES
}) {
  const sessions = new Map();
  const loginFailures = new Map();
  const baseAuthAccounts = normalizeAuthAccounts(authAccounts);
  db.authAccounts = Array.isArray(db.authAccounts) && db.authAccounts.length
    ? normalizeAuthAccounts(db.authAccounts)
    : [];
  if (!Number.isInteger(db.nextAuthAccountId)) db.nextAuthAccountId = nextRuntimeId(db.authAccounts);
  if (!Array.isArray(db.classes)) db.classes = [];
  if (!Number.isInteger(db.nextClassId)) db.nextClassId = nextRuntimeId(db.classes);
  for (const account of listAllAuthAccounts(baseAuthAccounts, db)) {
    if (account.role !== 'teacher') continue;
    for (const className of account.classNames || []) {
      ensureClassOption(db, className, account);
    }
  }
  const teacherDirectory = normalizeTeachers(teachers);
  const sessionMaxAgeMs = Number(sessionMaxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS) * 1000;
  const maxHomeworkFileBytes = Number(homeworkMaxFileBytes || DEFAULT_HOMEWORK_MAX_FILE_BYTES);
  const maxTranscriptFileBytes = Number(transcriptMaxFileBytes || DEFAULT_TRANSCRIPT_MAX_FILE_BYTES);

  return {
    createStudent(input) {
      const name = String(input.name || '').trim();
      const phone = String(input.phone || '').trim();
      const className = String(input.className || '').trim();
      if (!name || !className) {
        throw new Error('student name and class are required');
      }
      assertUniqueStudentPhone(db, phone);
      ensureClassOption(db, className);

      const student = {
        id: db.nextStudentId++,
        name,
        phone,
        gender: input.gender || '',
        birthday: input.birthday || '',
        className,
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
      const name = patch.name === undefined ? student.name : String(patch.name || '').trim();
      const phone = patch.phone === undefined ? student.phone : String(patch.phone || '').trim();
      const className = patch.className === undefined ? student.className : String(patch.className || '').trim();
      if (!name || !className) throw new Error('student name and class are required');
      assertUniqueStudentPhone(db, phone, id);
      ensureClassOption(db, className);
      student.name = name;
      student.phone = phone;
      student.gender = patch.gender ?? student.gender;
      student.birthday = patch.birthday ?? student.birthday;
      student.className = className;
      student.enrolledAt = patch.enrolledAt ?? student.enrolledAt;
      student.remark = patch.remark ?? student.remark;
      return student;
    },

    listStudents(filters = {}) {
      const page = Number(filters.page || 1);
      const pageSize = Number(filters.pageSize || db.students.length || 1);
      const accountDirectory = listAllAuthAccounts(baseAuthAccounts, db);
      const classNames = Array.isArray(filters.classNames)
        ? filters.classNames.map((className) => String(className || '').trim()).filter(Boolean)
        : null;
      const items = db.students.filter((student) => {
        if (filters.status && student.status !== filters.status) return false;
        if (filters.keyword) {
          const text = `${student.name} ${student.phone}`;
          if (!text.includes(filters.keyword)) return false;
        }
        if (filters.className && student.className !== filters.className) return false;
        if (classNames && !classNames.includes(student.className || '')) return false;
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
      return toCsvWithBom([['姓名（必填）', '手机号（选填）', '性别（选填）', '出生日期（选填）', '班级/课程（必填）', '入学日期（选填）', '备注（选填）']]);
    },

    previewStudentImport(input = {}) {
      return previewStudentImport(db, input);
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
        const stored = ensureStoredAccount(baseAuthAccounts, db, account);
        stored.password = '';
        stored.passwordHash = hashPassword(initialPassword);
        stored.passwordUpdatedAt = new Date().toISOString();
        accounts.push(publicStudentAccount(db, stored, { initialPassword }));
      }

      return { accounts, skipped, skippedCount: skipped.length };
    },

    updateStudentProfile(session = {}, patch = {}) {
      if (!session.studentId) throw createHttpError('student account not bound', 403);
      const student = db.students.find((item) => Number(item.id) === Number(session.studentId));
      if (!student) throw new Error('student not found');
      const phone = patch.phone === undefined ? student.phone : String(patch.phone || '').trim();
      assertUniqueStudentPhone(db, phone, student.id);
      student.phone = phone;
      student.gender = patch.gender === undefined ? student.gender : String(patch.gender || '').trim();
      student.birthday = patch.birthday === undefined ? student.birthday : String(patch.birthday || '').trim();
      student.enrolledAt = patch.enrolledAt === undefined ? student.enrolledAt : String(patch.enrolledAt || '').trim();
      student.remark = patch.remark === undefined ? student.remark : String(patch.remark || '').trim();
      return student;
    },

    archiveStudent(id) {
      const student = db.students.find((item) => item.id === id);
      if (!student) throw new Error('student not found');
      student.status = 'archived';
      student.archivedAt = new Date().toISOString();
      return student;
    },

    removeStudentFromTeacherClass(studentId, session = {}) {
      const student = db.students.find((item) => Number(item.id) === Number(studentId));
      if (!student) throw createHttpError('student not found', 404);
      assertTeacherStudentClassAccess(session, student);

      student.status = 'archived';
      student.archivedAt = new Date().toISOString();

      const account = listAllAuthAccounts(baseAuthAccounts, db)
        .find((item) => item.role === 'student' && Number(item.studentId) === Number(student.id));
      let accountDisabled = false;
      if (account) {
        const stored = ensureStoredAccount(baseAuthAccounts, db, account);
        stored.status = 'disabled';
        accountDisabled = true;
      }

      return { student, accountDisabled };
    },

    createHomeworkAssignment(input = {}, session = {}) {
      const homeworkName = String(input.homeworkName || '').trim();
      const className = String(input.className || '').trim();
      if (!homeworkName || !className) {
        throw new Error('homework name and class are required');
      }
      if (!findClassOption(db, className)) {
        throw new Error('class not found');
      }
      assertHomeworkClassAccess(session, className);

      const assignment = {
        id: db.nextHomeworkAssignmentId++,
        homeworkName,
        className,
        dueDate: input.dueDate || '',
        description: input.description || '',
        createdAt: input.createdAt || new Date().toISOString(),
        createdByRole: session.role || input.createdByRole || '',
        createdByName: session.username || input.createdByName || '',
        deletedAt: ''
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
      const classScope = resolveClassScope(filters);
      const items = db.homeworkAssignments
        .filter((assignment) => {
          if (!filters.includeDeletedAssignments && assignment.deletedAt) return false;
          if (!inClassScope(assignment.className, classScope)) return false;
          if (filters.className && assignment.className !== filters.className) return false;
          if (filters.keyword && !assignment.homeworkName.includes(filters.keyword)) return false;
          return true;
        })
        .map((assignment) => withHomeworkAssignmentStats(db, assignment, filters))
        .sort((left, right) => right.id - left.id);
      return { items, total: items.length };
    },

    deleteHomeworkAssignment(assignmentId, session = {}) {
      const assignment = db.homeworkAssignments.find((item) => Number(item.id) === Number(assignmentId));
      if (!assignment || assignment.deletedAt) throw createHttpError('homework assignment not found', 404);
      assertHomeworkClassAccess(session, assignment.className);
      assignment.deletedAt = new Date().toISOString();
      return { ...assignment };
    },

    syncHomeworkAssignmentRecords(assignmentId, session = {}) {
      const assignment = db.homeworkAssignments.find((item) => Number(item.id) === Number(assignmentId));
      if (!assignment) throw new Error('homework assignment not found');
      assertHomeworkClassAccess(session, assignment.className);

      const existingStudentIds = new Set(db.homeworkRecords
        .filter((record) => Number(record.assignmentId) === Number(assignment.id))
        .map((record) => Number(record.studentId)));
      const records = db.students
        .filter((student) => student.status === 'active')
        .filter((student) => student.className === assignment.className)
        .filter((student) => !existingStudentIds.has(Number(student.id)))
        .map((student) => this.addHomeworkRecord({
          assignmentId: assignment.id,
          studentId: student.id,
          homeworkName: assignment.homeworkName,
          className: assignment.className,
          dueDate: assignment.dueDate,
          description: assignment.description,
          submitStatus: 'pending'
        }));

      return {
        assignment: withHomeworkAssignmentStats(db, assignment),
        createdCount: records.length,
        records: records.map((record) => withHomeworkStudent(db, record))
      };
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
      const classScope = resolveClassScope(filters);
      const now = filters.now || new Date().toISOString();
      const items = db.homeworkRecords.filter((record) => {
        const student = db.students.find((item) => item.id === record.studentId);
        const assignment = record.assignmentId
          ? db.homeworkAssignments.find((item) => Number(item.id) === Number(record.assignmentId))
          : null;
        if (!filters.includeDeletedAssignments && assignment?.deletedAt) return false;
        if (!filters.includeArchivedStudents && student?.status !== 'active') return false;
        if (!inClassScope(record.className, classScope)) return false;
        if (filters.studentId && record.studentId !== Number(filters.studentId)) return false;
        if (filters.assignmentId && Number(record.assignmentId) !== Number(filters.assignmentId)) return false;
        if (filters.className && record.className !== filters.className) return false;
        if (filters.submitStatus === 'submitted' && !isHomeworkSubmittedStatus(record.submitStatus)) return false;
        if (filters.submitStatus && filters.submitStatus !== 'submitted' && record.submitStatus !== filters.submitStatus) return false;
        if (filters.lateStatus && homeworkLateStatus(record, now) !== filters.lateStatus) return false;
        if (filters.keyword) {
          const text = `${record.homeworkName} ${record.className} ${student?.name || ''} ${student?.phone || ''}`;
          if (!text.includes(filters.keyword)) return false;
        }
        return true;
      }).map((record) => withHomeworkStudent(db, record, now));
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
      const storedName = `${record.id}-${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const filePath = path.join(targetDir, storedName);
      const previousFile = { filePath: record.filePath };
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(filePath, content);

      record.submitStatus = 'submitted';
      record.submitAt = input.submittedAt || new Date().toISOString();
      record.remark = input.remark ?? record.remark;
      record.fileName = fileName;
      record.filePath = filePath;
      record.fileSize = content.length;
      record.fileType = inferHomeworkFileType(fileName) || input.contentType || 'application/octet-stream';
      removeStoredHomeworkFile(previousFile, uploadRoot);
      return withHomeworkStudent(db, record);
    },

    getHomeworkFile(id, session = {}) {
      const record = db.homeworkRecords.find((item) => item.id === Number(id));
      if (!record) throw new Error('homework record not found');
      if (session.role === 'student' && Number(session.studentId) !== Number(record.studentId)) {
        throw createHttpError('forbidden', 403);
      }
      if (session.role === 'teacher') {
        assertHomeworkClassAccess(session, record.className);
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
        remark: input.remark || '',
        transcriptFileName: input.transcriptFileName || '',
        transcriptFilePath: input.transcriptFilePath || '',
        transcriptFileSize: input.transcriptFileSize || 0,
        transcriptUploadedAt: input.transcriptUploadedAt || ''
      };
      assertScheduleTime(schedule);
      assertNoScheduleConflict(db.interviewSchedules, schedule);
      db.interviewSchedules.push(schedule);
      return schedule;
    },

    approveInterviewSchedule(id, input = {}, confirmedByRole = 'admin') {
      return confirmInterviewSchedule(db, id, input, confirmedByRole);
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
      assertTeacherParticipatesInScheduling(baseAuthAccounts, db, teacherDirectory, input.teacherId);
      assertStudentCanRequestSchedule(db, input.studentId);
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

    submitInterviewTranscriptFile(id, input = {}) {
      const schedule = db.interviewSchedules.find((item) => item.id === Number(id));
      if (!schedule) throw new Error('schedule not found');
      if (input.studentId !== undefined && Number(input.studentId) !== Number(schedule.studentId)) {
        throw createHttpError('forbidden', 403);
      }
      if (schedule.status !== 'completed') {
        throw new Error('schedule transcript requires completed interview');
      }

      const fileName = String(input.fileName || '').trim();
      const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content || '');
      assertAllowedTranscriptFile(fileName, content, maxTranscriptFileBytes);

      const targetDir = path.join(uploadRoot, 'interviews', String(schedule.id));
      const safeName = sanitizeFileName(fileName);
      const storedName = `${schedule.id}-${Date.now()}-${safeName}`;
      const filePath = path.join(targetDir, storedName);
      fs.mkdirSync(targetDir, { recursive: true });
      removeStoredInterviewTranscriptFile(schedule, uploadRoot);
      fs.writeFileSync(filePath, content);

      schedule.transcriptFileName = fileName;
      schedule.transcriptFilePath = filePath;
      schedule.transcriptFileSize = content.length;
      schedule.transcriptUploadedAt = input.uploadedAt || new Date().toISOString();
      return schedule;
    },

    getInterviewTranscriptFile(id, session = {}) {
      const schedule = db.interviewSchedules.find((item) => item.id === Number(id));
      if (!schedule) throw new Error('schedule not found');
      if (!canReadInterviewTranscript(schedule, session)) {
        throw createHttpError('forbidden', 403);
      }
      if (!schedule.transcriptFilePath || !fs.existsSync(schedule.transcriptFilePath)) {
        throw createHttpError('interview transcript file not found', 404);
      }
      return {
        fileName: schedule.transcriptFileName || path.basename(schedule.transcriptFilePath),
        contentType: 'text/plain; charset=utf-8',
        body: fs.readFileSync(schedule.transcriptFilePath)
      };
    },

    listInterviewSchedules(filters = {}) {
      const items = db.interviewSchedules.filter((schedule) => {
        if (filters.teacherId && schedule.teacherId !== Number(filters.teacherId)) return false;
        if (filters.studentId && schedule.studentId !== Number(filters.studentId)) return false;
        if (filters.status && schedule.status !== filters.status) return false;
        if (filters.from && schedule.endsAt <= filters.from) return false;
        if (filters.to && schedule.startsAt >= filters.to) return false;
        if (filters.keyword) {
          const keyword = String(filters.keyword || '').trim();
          const text = `${schedule.studentName || ''} ${schedule.companyName || ''} ${schedule.positionName || ''}`;
          if (keyword && !text.includes(keyword)) return false;
        }
        return true;
      });
      return { items, total: items.length };
    },

    listStudentWeeklySchedules(session = {}, filters = {}) {
      if (!session?.studentId) throw new Error('student account not bound');
      const studentId = Number(session.studentId);
      const days = buildWeek(filters.weekStart || currentWeekStart());
      const from = `${days[0]}T00:00:00`;
      const to = `${days[6]}T23:59:59`;
      const entries = this.listInterviewSchedules({ from, to }).items
        .filter((schedule) => schedule.status !== 'cancelled')
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .map((schedule) => redactScheduleForStudent(schedule, studentId));
      return { weeks: days, entries };
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
        interviewRecords: this.listInterviewRecords({ studentId }).items
      };
    },

    getDashboardStats() {
      const active = db.students.filter((student) => student.status === 'active').length;
      const archived = db.students.filter((student) => student.status === 'archived').length;
      const completed = db.homeworkRecords.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
      const hired = db.interviewRecords.filter((record) => record.hiredStatus === 'hired').length;
      const interviewTotal = db.interviewRecords.length;
      const interviewResults = countByEnum(db.interviewRecords, 'result', VALID_INTERVIEW_RESULTS);
      const hiredStatuses = countByEnum(db.interviewRecords, 'hiredStatus', VALID_HIRED_STATUSES);
      const pendingSchedules = db.interviewSchedules
        .filter((schedule) => schedule.status === 'requested')
        .slice()
        .sort((left, right) => String(right.startsAt || '').localeCompare(String(left.startsAt || '')))
        .slice(0, 8);
      const recentInterviews = db.interviewRecords
        .slice()
        .sort((left, right) => String(right.interviewAt || '').localeCompare(String(left.interviewAt || '')))
        .slice(0, 8)
        .map((record) => withInterviewStudent(db, record));

      return {
        students: { active, archived, total: db.students.length },
        homework: { total: db.homeworkRecords.length, completed },
        interviews: { total: interviewTotal, ...interviewResults },
        interviewResults,
        hiredStatuses,
        pendingSchedules,
        recentInterviews,
        employmentRate: interviewTotal === 0 ? 0 : Math.round((hired / interviewTotal) * 100)
      };
    },

    getHomeworkAnalytics(filters = {}) {
      return buildHomeworkAnalytics(db, filters);
    },

    listTeachers(filters = {}) {
      const items = buildTeacherProfiles(baseAuthAccounts, db, teacherDirectory, filters)
        .filter((teacher) => !filters.forStudent || teacher.participatesInScheduling);
      return { items, total: items.length };
    },

    updateTeacherScheduling(session = {}, input = {}) {
      if (!session.teacherId || !session.username) throw createHttpError('teacher account not bound', 403);
      const account = findAuthAccountByKey(baseAuthAccounts, db, `username:${session.username}`, { required: false });
      if (!account) throw new Error('teacher account not found');
      const stored = ensureStoredAccount(baseAuthAccounts, db, account);
      stored.participatesInScheduling = input.participatesInScheduling === true;
      session.participatesInScheduling = stored.participatesInScheduling;
      const teacher = publicTeacherAccount(stored, teacherDirectory, db);
      return teacher;
    },

    listTeacherAccounts() {
      const items = buildTeacherProfiles(baseAuthAccounts, db, teacherDirectory, { includeDisabled: true });
      return { items, total: items.length };
    },

    createTeacherAccount(input = {}) {
      const username = String(input.username || '').trim();
      const teacherName = String(input.teacherName || '').trim();
      if (!username || !teacherName) throw new Error('teacher username and name are required');
      const existing = listAllAuthAccounts(baseAuthAccounts, db, { includeDisabled: true })
        .find((account) => account.username === username);
      if (existing) throw new Error('account username already exists');
      const initialPassword = String(input.initialPassword || '').trim() || generateInitialPassword();
      const account = {
        id: db.nextAuthAccountId++,
        username,
        password: '',
        passwordHash: hashPassword(initialPassword),
        role: 'teacher',
        teacherId: nextTeacherId(baseAuthAccounts, db, teacherDirectory),
        studentId: null,
        teacherName,
        classNames: normalizeClassNameList(input.classNames),
        participatesInScheduling: input.participatesInScheduling === true,
        status: 'active',
        createdAt: new Date().toISOString(),
        passwordUpdatedAt: new Date().toISOString()
      };
      db.authAccounts.push(account);
      for (const className of account.classNames) ensureClassOption(db, className);
      return publicTeacherAccount(account, teacherDirectory, db, { initialPassword });
    },

    updateTeacherAccount(accountKey, input = {}) {
      const account = findAuthAccountByKey(baseAuthAccounts, db, accountKey, { required: false });
      if (!account || account.role !== 'teacher') throw new Error('teacher account not found');
      const stored = ensureStoredAccount(baseAuthAccounts, db, account);
      if (input.teacherName !== undefined) stored.teacherName = String(input.teacherName || '').trim();
      if (input.classNames !== undefined) {
        stored.classNames = normalizeClassNameList(input.classNames);
        for (const className of stored.classNames) ensureClassOption(db, className);
      }
      if (input.participatesInScheduling !== undefined) {
        stored.participatesInScheduling = input.participatesInScheduling === true;
      }
      if (input.status !== undefined) {
        stored.status = input.status === 'disabled' ? 'disabled' : 'active';
      }
      return publicTeacherAccount(stored, teacherDirectory, db);
    },

    disableTeacherAccount(accountKey) {
      const account = findAuthAccountByKey(baseAuthAccounts, db, accountKey, { required: false });
      if (!account || account.role !== 'teacher') throw new Error('teacher account not found');
      const stored = ensureStoredAccount(baseAuthAccounts, db, account);
      stored.status = 'disabled';
      return publicTeacherAccount(stored, teacherDirectory, db);
    },

    disableStudentAccount(studentId) {
      const account = listAllAuthAccounts(baseAuthAccounts, db, { includeDisabled: true })
        .find((item) => item.role === 'student' && Number(item.studentId) === Number(studentId));
      if (!account) throw new Error('student account not found');
      const stored = ensureStoredAccount(baseAuthAccounts, db, account);
      stored.status = 'disabled';
      return publicStudentAccount(db, stored);
    },

    listClasses(filters = {}) {
      const allowedClassNames = Array.isArray(filters.classNames)
        ? filters.classNames.map((className) => String(className || '').trim()).filter(Boolean)
        : null;
      const classes = new Map();
      for (const classOption of db.classes) {
        if (!classOption.className) continue;
        if (allowedClassNames && !allowedClassNames.includes(classOption.className)) continue;
        classes.set(classOption.className, 0);
      }
      for (const student of db.students) {
        if (student.status !== 'active' || !student.className) continue;
        if (allowedClassNames && !allowedClassNames.includes(student.className)) continue;
        classes.set(student.className, (classes.get(student.className) || 0) + 1);
      }
      if (allowedClassNames) {
        for (const className of allowedClassNames) {
          if (!classes.has(className)) classes.set(className, 0);
        }
      }
      const items = Array.from(classes.entries())
        .map(([className, studentCount]) => {
          const classOption = findClassOption(db, className);
          return { id: classOption?.id || null, className, studentCount };
        })
        .sort((left, right) => left.className.localeCompare(right.className, 'zh-CN'));
      return { items, total: items.length };
    },

    createClass(input = {}, session = {}) {
      const className = String(input.className || '').trim();
      if (!className) throw new Error('class name is required');
      const classOption = ensureClassOption(db, className, session);
      if (session.role === 'teacher' && Array.isArray(session.classNames) && !session.classNames.includes(className)) {
        session.classNames.push(className);
        session.classNames.sort((left, right) => left.localeCompare(right, 'zh-CN'));
      }
      return publicClassOption(db, classOption);
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
      const upgradeTarget = account.source === 'stored'
        ? db.authAccounts.find((item) => Number(item.id) === Number(account.id)) || account
        : account;
      if (upgradeLegacyAccountPassword(upgradeTarget, password)) {
        db.save();
      }
      loginFailures.delete(normalizedUsername);
      const token = crypto.randomUUID();
      const session = {
        role: account.role,
        username: account.username,
        teacherId: account.teacherId || null,
        studentId: account.studentId || null,
        teacherName: account.role === 'teacher'
          ? (account.teacherName || teacherDirectory.find((teacher) => Number(teacher.id) === Number(account.teacherId))?.name || '')
          : '',
        participatesInScheduling: account.role === 'teacher' ? account.participatesInScheduling === true : false,
        classNames: account.role === 'teacher' ? teacherClassNamesForAccount(db, account) : [],
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
      const rows = [['作业名称', '学生姓名', '手机号', '班级/课程', '提交状态', '逾期状态', '提交时间', '文件名', '备注']];
      for (const record of records) {
        rows.push([
          record.homeworkName,
          record.studentName || `#${record.studentId}`,
          record.studentPhone || '',
          record.className,
          statusLabel(record.submitStatus),
          homeworkLateStatusLabel(record.lateStatus),
          record.submitAt,
          record.fileName || '',
          record.remark
        ]);
      }
      return toCsvWithBom(rows);
    },

    exportHomeworkAssignmentZip(assignmentId, session = {}) {
      const assignment = db.homeworkAssignments.find((item) => item.id === Number(assignmentId));
      if (!assignment) throw new Error('homework assignment not found');
      if (assignment.deletedAt) throw createHttpError('homework assignment not found', 404);
      assertHomeworkClassAccess(session, assignment.className);
      const records = this.listHomeworkRecords({ assignmentId }).items;
      const rows = [['作业名称', '班级/课程', '学生姓名', '手机号', '提交状态', '逾期状态', '提交时间', '文件名', '备注']];
      const entries = [];

      for (const record of records) {
        rows.push([
          record.homeworkName,
          record.className,
          record.studentName || `#${record.studentId}`,
          record.studentPhone || '',
          statusLabel(record.submitStatus),
          homeworkLateStatusLabel(record.lateStatus),
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

    exportHomeworkStudentZip(studentId, filters = {}, session = {}) {
      const student = requireExistingStudent(db, studentId);
      if (session.role === 'teacher') {
        assertHomeworkClassAccess(session, student.className);
        if (filters.className) assertHomeworkClassAccess(session, filters.className);
      }
      const records = this.listHomeworkRecords({
        studentId: student.id,
        assignmentId: filters.assignmentId,
        className: filters.className,
        classNames: session.role === 'teacher' ? session.classNames : filters.classNames
      }).items;
      const rows = [['作业名称', '班级/课程', '学生姓名', '手机号', '提交状态', '逾期状态', '提交时间', '文件名', '备注']];
      const entries = [];

      for (const record of records) {
        rows.push([
          record.homeworkName,
          record.className,
          record.studentName || student.name || `#${record.studentId}`,
          record.studentPhone || student.phone || '',
          statusLabel(record.submitStatus),
          homeworkLateStatusLabel(record.lateStatus),
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
      teacherName: account.teacherName || '',
      classNames: Array.isArray(account.classNames)
        ? account.classNames.map((className) => String(className || '').trim()).filter(Boolean)
        : [],
      participatesInScheduling: account.participatesInScheduling === true,
      status: account.status || 'active',
      createdAt: account.createdAt || '',
      passwordUpdatedAt: account.passwordUpdatedAt || ''
    };
  });
}

function listAllAuthAccounts(baseAuthAccounts, db, options = {}) {
  const storedAccounts = Array.isArray(db.authAccounts) ? db.authAccounts : [];
  const byUsername = new Map();

  for (const account of baseAuthAccounts) {
    byUsername.set(account.username, {
      ...account,
      source: 'config',
      accountKey: `username:${account.username}`
    });
  }

  for (const account of storedAccounts) {
    const previous = byUsername.get(account.username) || {};
    byUsername.set(account.username, {
      ...previous,
      ...account,
      source: 'stored',
      accountKey: `stored:${account.id}`
    });
  }

  const accounts = Array.from(byUsername.values());
  return options.includeDisabled ? accounts : accounts.filter((account) => account.status !== 'disabled');
}

function findAuthAccountByKey(baseAuthAccounts, db, accountKey, options = {}) {
  const key = String(accountKey || '').trim();
  return listAllAuthAccounts(baseAuthAccounts, db, { includeDisabled: true })
    .find((account) => {
      if (account.accountKey === key) return true;
      if (key.startsWith('username:') && account.username === key.slice('username:'.length)) return true;
      if (key.startsWith('stored:') && Number(account.id) === Number(key.slice('stored:'.length))) return true;
      return false;
    }) || (options.required === false ? null : undefined);
}

function ensureStoredAccount(baseAuthAccounts, db, account) {
  if (account?.source === 'stored') {
    const stored = db.authAccounts.find((item) => Number(item.id) === Number(account.id));
    if (stored) return stored;
  }

  const copy = {
    id: db.nextAuthAccountId++,
    username: account.username,
    password: account.password || '',
    passwordHash: account.passwordHash || '',
    role: account.role,
    teacherId: account.teacherId || null,
    studentId: account.studentId || null,
    teacherName: account.teacherName || '',
    classNames: normalizeClassNameList(account.classNames),
    participatesInScheduling: account.participatesInScheduling === true,
    status: account.status || 'active',
    createdAt: account.createdAt || new Date().toISOString(),
    passwordUpdatedAt: account.passwordUpdatedAt || ''
  };
  db.authAccounts.push(copy);
  return copy;
}

function normalizeClassNameList(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  for (const value of values) {
    const className = String(value || '').trim();
    if (className && !result.includes(className)) result.push(className);
  }
  return result;
}

function findClassOption(db, className) {
  const normalized = String(className || '').trim();
  return (db.classes || []).find((item) => item.className === normalized) || null;
}

function ensureClassOption(db, className, session = {}) {
  const normalized = String(className || '').trim();
  if (!normalized) throw new Error('class name is required');
  if (!Array.isArray(db.classes)) db.classes = [];
  let classOption = findClassOption(db, normalized);
  if (!classOption) {
    classOption = {
      id: db.nextClassId++,
      className: normalized,
      createdAt: new Date().toISOString(),
      createdByRole: session.role || '',
      createdByName: session.username || '',
      teacherIds: [],
      teacherUsernames: []
    };
    db.classes.push(classOption);
  }
  bindClassToTeacher(classOption, session);
  return classOption;
}

function bindClassToTeacher(classOption, session = {}) {
  if (session.role !== 'teacher') return;
  if (!Array.isArray(classOption.teacherIds)) classOption.teacherIds = [];
  if (!Array.isArray(classOption.teacherUsernames)) classOption.teacherUsernames = [];
  if (session.teacherId && !classOption.teacherIds.includes(Number(session.teacherId))) {
    classOption.teacherIds.push(Number(session.teacherId));
  }
  if (session.username && !classOption.teacherUsernames.includes(session.username)) {
    classOption.teacherUsernames.push(session.username);
  }
}

function publicClassOption(db, classOption) {
  return {
    id: classOption.id,
    className: classOption.className,
    studentCount: db.students.filter((student) =>
      student.status === 'active' && student.className === classOption.className
    ).length
  };
}

function teacherClassNamesForAccount(db, account) {
  const names = new Set((account.classNames || []).filter(Boolean));
  for (const classOption of db.classes || []) {
    if ((classOption.teacherIds || []).includes(Number(account.teacherId))) names.add(classOption.className);
    if ((classOption.teacherUsernames || []).includes(account.username)) names.add(classOption.className);
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function assertUniqueStudentPhone(db, phone, currentStudentId = null) {
  const normalized = String(phone || '').trim();
  if (!normalized) return;
  const duplicate = db.students.find((student) =>
    student.phone === normalized && Number(student.id) !== Number(currentStudentId)
  );
  if (duplicate) throw new Error('student phone already exists');
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

function buildTeacherProfiles(baseAuthAccounts, db, teacherDirectory, filters = {}) {
  const accountProfiles = listAllAuthAccounts(baseAuthAccounts, db, { includeDisabled: filters.includeDisabled === true })
    .filter((account) => account.role === 'teacher')
    .map((account) => publicTeacherAccount(account, teacherDirectory, db));
  const accountTeacherIds = new Set(accountProfiles.map((teacher) => Number(teacher.id)));
  const legacyProfiles = filters.includeDisabled
    ? []
    : teacherDirectory
      .filter((teacher) => !accountTeacherIds.has(Number(teacher.id)))
      .map((teacher) => ({
        id: teacher.id,
        teacherId: teacher.id,
        name: teacher.name,
        teacherName: teacher.name,
        username: '',
        classNames: [],
        participatesInScheduling: true,
        status: 'active',
        accountKey: ''
      }));

  return [...accountProfiles, ...legacyProfiles]
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function publicTeacherAccount(account, teacherDirectory, db, options = {}) {
  const directoryTeacher = teacherDirectory.find((teacher) => Number(teacher.id) === Number(account.teacherId));
  const teacherName = account.teacherName || directoryTeacher?.name || account.username || `teacher${account.teacherId}`;
  const payload = {
    id: account.teacherId,
    teacherId: account.teacherId,
    name: teacherName,
    teacherName,
    username: account.username,
    classNames: teacherClassNamesForAccount(db, account),
    participatesInScheduling: account.participatesInScheduling === true,
    status: account.status || 'active',
    accountKey: account.accountKey || (account.source === 'stored' ? `stored:${account.id}` : `username:${account.username}`),
    createdAt: account.createdAt || ''
  };
  if (options.initialPassword) payload.initialPassword = options.initialPassword;
  return payload;
}

function nextTeacherId(baseAuthAccounts, db, teacherDirectory) {
  const maxFromAccounts = listAllAuthAccounts(baseAuthAccounts, db, { includeDisabled: true })
    .filter((account) => account.role === 'teacher')
    .reduce((max, account) => Math.max(max, Number(account.teacherId) || 0), 0);
  const maxFromDirectory = teacherDirectory.reduce((max, teacher) => Math.max(max, Number(teacher.id) || 0), 0);
  return Math.max(maxFromAccounts, maxFromDirectory) + 1;
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

function countByEnum(records, fieldName, values) {
  const result = {};
  for (const value of values) {
    result[value] = 0;
  }
  for (const record of records) {
    const value = values.has(record[fieldName]) ? record[fieldName] : 'pending';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
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

function withHomeworkAssignmentStats(db, assignment, options = {}) {
  const now = typeof options === 'string' ? options : (options.now || new Date().toISOString());
  const includeArchivedStudents = typeof options === 'object' && options.includeArchivedStudents === true;
  const records = db.homeworkRecords
    .filter((record) => Number(record.assignmentId) === Number(assignment.id))
    .filter((record) => includeArchivedStudents || isHomeworkRecordForActiveStudent(db, record));
  const submittedCount = records.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
  const overduePendingCount = records.filter((record) => homeworkLateStatus(record, now) === 'overduePending').length;
  const lateSubmittedCount = records.filter((record) => homeworkLateStatus(record, now) === 'lateSubmitted').length;
  const totalCount = records.length;
  return {
    ...assignment,
    totalCount,
    submittedCount,
    pendingCount: totalCount - submittedCount,
    overduePendingCount,
    lateSubmittedCount
  };
}

function isHomeworkRecordForActiveStudent(db, record) {
  const student = db.students.find((item) => Number(item.id) === Number(record.studentId));
  return student?.status === 'active';
}

function isHomeworkSubmittedStatus(status) {
  return status === 'submitted' || status === 'reviewed';
}

function assertHomeworkClassAccess(session = {}, className = '') {
  if (session.role !== 'teacher') return;
  const classNames = Array.isArray(session.classNames) ? session.classNames : [];
  if (!classNames.includes(className || '')) {
    throw createHttpError('forbidden', 403);
  }
}

function assertTeacherStudentClassAccess(session = {}, student = {}) {
  if (session.role !== 'teacher') {
    throw createHttpError('forbidden', 403);
  }
  const classNames = Array.isArray(session.classNames) ? session.classNames : [];
  if (!classNames.includes(student.className || '')) {
    throw createHttpError('forbidden', 403);
  }
}

function homeworkLateStatus(record, now = new Date().toISOString()) {
  if (!record?.dueDate) return '';
  const dueTime = Date.parse(`${record.dueDate}T23:59:59`);
  if (!Number.isFinite(dueTime)) return '';
  if (isHomeworkSubmittedStatus(record.submitStatus)) {
    if (!record.submitAt) return '';
    const submitTime = Date.parse(record.submitAt);
    if (!Number.isFinite(submitTime)) return '';
    return submitTime > dueTime ? 'lateSubmitted' : '';
  }

  const nowTime = Date.parse(now);
  if (!Number.isFinite(nowTime)) return '';
  return nowTime > dueTime ? 'overduePending' : '';
}

function buildHomeworkAnalytics(db, filters = {}) {
  const classScope = resolveClassScope(filters);
  const activeStudents = db.students.filter((student) => student.status === 'active');
  const students = activeStudents.filter((student) => inClassScope(student.className, classScope));
  const assignments = db.homeworkAssignments
    .filter((assignment) => !assignment.deletedAt)
    .filter((assignment) => inClassScope(assignment.className, classScope))
    .slice()
    .sort((left, right) => right.id - left.id);
  const assignmentIds = new Set(assignments.map((assignment) => Number(assignment.id)));
  const records = db.homeworkRecords.filter((record) => {
    return assignmentIds.has(Number(record.assignmentId)) &&
      inClassScope(record.className, classScope) &&
      isHomeworkRecordForActiveStudent(db, record);
  });
  const latestAssignment = assignments[0] || null;

  return {
    overview: buildHomeworkOverview(students, assignments, records),
    classes: buildHomeworkClassAnalytics(activeStudents, db.homeworkAssignments, db.homeworkRecords, classScope.classNames),
    assignments: assignments.map((assignment) => {
      const assignmentRecords = records.filter((record) => Number(record.assignmentId) === Number(assignment.id));
      return {
        id: assignment.id,
        homeworkName: assignment.homeworkName,
        className: assignment.className,
        dueDate: assignment.dueDate || '',
        createdAt: assignment.createdAt || '',
        ...completionStats(assignmentRecords, filters.now)
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
        overduePendingCount: studentRecords.filter((record) => homeworkLateStatus(record, filters.now) === 'overduePending').length,
        lateSubmittedCount: studentRecords.filter((record) => homeworkLateStatus(record, filters.now) === 'lateSubmitted').length,
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

function resolveClassScope(filters = {}) {
  const className = String(filters.className || '').trim();
  if (className) return { classNames: [className] };
  if (Array.isArray(filters.classNames)) {
    return {
      classNames: filters.classNames
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    };
  }
  return { classNames: null };
}

function inClassScope(className, scope) {
  if (!scope.classNames) return true;
  return scope.classNames.includes(className || '');
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

function buildHomeworkClassAnalytics(students, assignments, records, selectedClassNames = null) {
  const classNames = new Set();
  const selected = Array.isArray(selectedClassNames) ? selectedClassNames : null;
  for (const student of students) {
    if (student.className) classNames.add(student.className);
  }
  for (const assignment of assignments) {
    if (assignment.className) classNames.add(assignment.className);
  }
  for (const record of records) {
    if (record.className) classNames.add(record.className);
  }
  if (selected) {
    for (const className of selected) {
      if (className) classNames.add(className);
    }
  }

  return Array.from(classNames)
    .filter((className) => !selected || selected.includes(className))
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

function completionStats(records, now = new Date().toISOString()) {
  const submittedCount = records.filter((record) => isHomeworkSubmittedStatus(record.submitStatus)).length;
  return {
    totalCount: records.length,
    submittedCount,
    pendingCount: records.length - submittedCount,
    overduePendingCount: records.filter((record) => homeworkLateStatus(record, now) === 'overduePending').length,
    lateSubmittedCount: records.filter((record) => homeworkLateStatus(record, now) === 'lateSubmitted').length,
    completionRate: percentage(submittedCount, records.length)
  };
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function withHomeworkStudent(db, record, now = new Date().toISOString()) {
  const student = db.students.find((item) => item.id === record.studentId);
  return {
    ...record,
    studentName: student?.name || '',
    studentPhone: student?.phone || '',
    lateStatus: homeworkLateStatus(record, now),
    lateStatusText: homeworkLateStatusLabel(homeworkLateStatus(record, now))
  };
}

function withInterviewStudent(db, record) {
  const student = db.students.find((item) => item.id === record.studentId);
  return {
    ...record,
    studentName: student?.name || '',
    studentPhone: student?.phone || '',
    className: student?.className || ''
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

function assertAllowedTranscriptFile(fileName, content, maxBytes) {
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_TRANSCRIPT_FILE_EXTENSIONS.has(extension)) {
    throw new Error('unsupported interview transcript file type');
  }
  if (!content.length) {
    throw new Error('interview transcript file is required');
  }
  if (content.length > maxBytes) {
    throw createHttpError('interview transcript file too large', 413);
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

function removeStoredInterviewTranscriptFile(schedule, uploadRoot) {
  if (!schedule.transcriptFilePath) return;
  const resolvedFile = path.resolve(schedule.transcriptFilePath);
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

function homeworkLateStatusLabel(status) {
  const labels = {
    overduePending: '逾期未交',
    lateSubmitted: '迟交'
  };
  return labels[status] || '';
}

function confirmInterviewSchedule(db, id, input, confirmedByRole) {
  const schedule = db.interviewSchedules.find((item) => item.id === id);
  if (!schedule) throw new Error('schedule not found');
  if (schedule.status === 'confirmed') return schedule;
  assertScheduleTransition(schedule, ['requested'], 'confirmed');
  schedule.status = 'confirmed';
  schedule.confirmedByRole = confirmedByRole;
  schedule.confirmedByName = input.approverName || input.confirmedByName || '';
  schedule.confirmedAt = input.confirmedAt || new Date().toISOString();
  return schedule;
}

function assertTeacherParticipatesInScheduling(baseAuthAccounts, db, teacherDirectory, teacherId) {
  const normalizedTeacherId = normalizeRequiredId(teacherId, 'teacherId is required');
  const teacher = buildTeacherProfiles(baseAuthAccounts, db, teacherDirectory)
    .find((item) => Number(item.id) === normalizedTeacherId);
  if (!teacher) throw new Error('teacher not available for scheduling');
  if (teacher.username && teacher.participatesInScheduling !== true) {
    throw new Error('teacher not available for scheduling');
  }
}

function assertStudentCanRequestSchedule(db, studentId) {
  const guard = buildStudentScheduleGuard(db, normalizeRequiredId(studentId, 'studentId is required'));
  if (guard.canRequest) return;
  throw new Error(guard.reason);
}

function buildStudentScheduleGuard(db, studentId) {
  const studentSchedules = db.interviewSchedules.filter((schedule) => Number(schedule.studentId) === Number(studentId));
  const pendingTranscriptSchedules = studentSchedules
    .filter(isScheduleTranscriptRequired)
    .sort((left, right) => String(right.startsAt || '').localeCompare(String(left.startsAt || '')));
  const unfinishedCount = studentSchedules.filter((schedule) => UNFINISHED_SCHEDULE_STATUSES.has(schedule.status)).length;
  let reason = '';

  if (pendingTranscriptSchedules.length) {
    reason = 'interview transcript required';
  } else if (unfinishedCount >= MAX_UNFINISHED_STUDENT_SCHEDULES) {
    reason = 'unfinished schedule limit reached';
  }

  return {
    canRequest: !reason,
    reason,
    unfinishedCount,
    maxUnfinishedCount: MAX_UNFINISHED_STUDENT_SCHEDULES,
    pendingTranscriptSchedules: pendingTranscriptSchedules.map((schedule) => ({ ...schedule }))
  };
}

function isScheduleTranscriptRequired(schedule) {
  return schedule.status === 'completed' && (!schedule.transcriptUploadedAt || !schedule.transcriptFilePath);
}

function redactScheduleForStudent(schedule, currentStudentId) {
  const isOwn = Number(schedule.studentId) === Number(currentStudentId);
  const entry = {
    id: schedule.id,
    teacherId: schedule.teacherId,
    teacherName: schedule.teacherName || '',
    companyName: schedule.companyName || '',
    positionName: schedule.positionName || '',
    startsAt: schedule.startsAt || '',
    endsAt: schedule.endsAt || '',
    status: schedule.status || '',
    isOwn,
    studentName: isOwn ? (schedule.studentName || '') : ''
  };
  if (isOwn) {
    entry.studentId = schedule.studentId;
    entry.transcriptFileName = schedule.transcriptFileName || '';
    entry.transcriptUploadedAt = schedule.transcriptUploadedAt || '';
  }
  return entry;
}

function canReadInterviewTranscript(schedule, session = {}) {
  if (session.role === 'admin') return true;
  if (session.role === 'teacher') return Number(session.teacherId) === Number(schedule.teacherId);
  if (session.role === 'student') return Number(session.studentId) === Number(schedule.studentId);
  return false;
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

function currentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
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

function previewStudentImport(db, input = {}) {
  const options = typeof input === 'string' ? { text: input } : input;
  const mode = String(options.mode || '').trim();
  const parsedSimplePaste = mode === 'simplePaste'
    ? parseSimplePasteRows(options.text || options.csv || '', options.defaultClassName)
    : null;
  const rows = parsedSimplePaste ? parsedSimplePaste.rows : parseCsv(options.text || options.csv || '');
  const { dataRows, header } = parsedSimplePaste
    ? { dataRows: rows, header: { name: 0, className: 1 } }
    : splitImportHeader(rows);
  const rowNumberBase = parsedSimplePaste
    ? (parsedSimplePaste.hasHeader ? 2 : 1)
    : (header ? 2 : 1);
  const existingPhones = new Set(db.students.map((student) => student.phone).filter(Boolean));
  const existingClasses = new Set((db.classes || []).map((item) => item.className).filter(Boolean));
  const seenPhones = new Set();
  const previewRows = dataRows.map((cells, index) => {
    const student = readStudentImportRow(cells, header);
    const errors = [];

    if (!student.name) errors.push('姓名不能为空');
    if (!student.className) errors.push('班级不能为空');
    if (student.className && !existingClasses.has(student.className)) {
      errors.push('班级不存在，请先新增班级');
    }
    if (student.phone && (existingPhones.has(student.phone) || seenPhones.has(student.phone))) {
      errors.push('手机号重复');
    }
    if (student.phone && !seenPhones.has(student.phone)) {
      seenPhones.add(student.phone);
    }

    return {
      rowNumber: index + rowNumberBase,
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

function parseSimplePasteRows(text, defaultClassName = '') {
  const fallbackClassName = String(defaultClassName || '').trim();
  const lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/);
  const rows = [];

  for (const line of lines) {
    const raw = line.replace(/\r$/, '');
    if (!raw.trim()) continue;
    let cells = raw.includes('\t')
      ? raw.split('\t').map((cell) => cell.trim())
      : raw.trim().split(/\s{2,}|,|，/).map((cell) => cell.trim()).filter((cell) => cell);
    if (cells.length === 1 && fallbackClassName) cells = [cells[0], fallbackClassName];
    rows.push([cells[0] || '', cells[1] || '']);
  }

  const hasHeader = rows.length > 0 && isSimplePasteHeader(rows[0]);
  return { rows: hasHeader ? rows.slice(1) : rows, hasHeader };
}

function isSimplePasteHeader(row) {
  const first = String(row[0] || '').toLowerCase();
  const second = String(row[1] || '').toLowerCase();
  return first === 'name' || first.includes('姓名') || first.includes('濮撳悕') ||
    second.includes('class') || second.includes('班级') || second.includes('鐝骇');
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
  const text = String(cell || '').trim().replace(/（必填）|（选填）|\(必填\)|\(选填\)/g, '');
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
