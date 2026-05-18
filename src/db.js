const fs = require('node:fs');
const path = require('node:path');

const CURRENT_SCHEMA_VERSION = 5;
const VALID_STUDENT_LEARNING_STAGES = new Set(['studying', 'job_seeking', 'employed']);

function createDatabase(options = {}) {
  const filePath = options.filePath || null;
  const state = loadState(filePath);

  return {
    filePath,
    schemaVersion: state.schemaVersion,
    students: state.students,
    homeworkAssignments: state.homeworkAssignments,
    homeworkRecords: state.homeworkRecords,
    interviewRecords: state.interviewRecords,
    interviewSchedules: state.interviewSchedules,
    classes: state.classes,
    authAccounts: state.authAccounts,
    nextStudentId: state.nextStudentId,
    nextHomeworkAssignmentId: state.nextHomeworkAssignmentId,
    nextHomeworkId: state.nextHomeworkId,
    nextInterviewId: state.nextInterviewId,
    nextInterviewScheduleId: state.nextInterviewScheduleId,
    nextClassId: state.nextClassId,
    nextAuthAccountId: state.nextAuthAccountId,
    save() {
      if (!filePath) return;
      const payload = JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        students: this.students,
        homeworkAssignments: this.homeworkAssignments,
        homeworkRecords: this.homeworkRecords,
        interviewRecords: this.interviewRecords,
        interviewSchedules: this.interviewSchedules,
        classes: this.classes,
        authAccounts: this.authAccounts,
        nextStudentId: this.nextStudentId,
        nextHomeworkAssignmentId: this.nextHomeworkAssignmentId,
        nextHomeworkId: this.nextHomeworkId,
        nextInterviewId: this.nextInterviewId,
        nextInterviewScheduleId: this.nextInterviewScheduleId,
        nextClassId: this.nextClassId,
        nextAuthAccountId: this.nextAuthAccountId
      }, null, 2);
      const tmpPath = `${filePath}.tmp`;
      const backupPath = `${filePath}.bak`;

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
      }
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, filePath);
    }
  };
}

function loadState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return createEmptyState();
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`database file is not valid JSON: ${filePath}`);
  }

  return normalizeState(raw);
}

function createEmptyState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    students: [],
    homeworkAssignments: [],
    homeworkRecords: [],
    interviewRecords: [],
    interviewSchedules: [],
    classes: [],
    authAccounts: [],
    nextStudentId: 1,
    nextHomeworkAssignmentId: 1,
    nextHomeworkId: 1,
    nextInterviewId: 1,
    nextInterviewScheduleId: 1,
    nextClassId: 1,
    nextAuthAccountId: 1
  };
}

function normalizeState(raw) {
  const students = normalizeStudents(raw.students || []);
  const homeworkAssignments = normalizeHomeworkAssignments(raw.homeworkAssignments || []);
  const homeworkRecords = normalizeHomeworkRecords(raw.homeworkRecords || []);
  const interviewRecords = normalizeInterviewRecords(raw.interviewRecords || []);
  const interviewSchedules = normalizeInterviewSchedules(raw.interviewSchedules || []);
  const authAccounts = normalizeAuthAccounts(raw.authAccounts || []);
  const classes = normalizeClasses(raw.classes || [], {
    students,
    homeworkAssignments,
    homeworkRecords,
    authAccounts
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    students,
    homeworkAssignments,
    homeworkRecords,
    interviewRecords,
    interviewSchedules,
    classes,
    authAccounts,
    nextStudentId: nextId(raw.nextStudentId, students),
    nextHomeworkAssignmentId: nextId(raw.nextHomeworkAssignmentId, homeworkAssignments),
    nextHomeworkId: nextId(raw.nextHomeworkId, homeworkRecords),
    nextInterviewId: nextId(raw.nextInterviewId, interviewRecords),
    nextInterviewScheduleId: nextId(raw.nextInterviewScheduleId, interviewSchedules),
    nextClassId: nextId(raw.nextClassId, classes),
    nextAuthAccountId: nextId(raw.nextAuthAccountId, authAccounts)
  };
}

function normalizeStudents(students) {
  return students.map((student) => ({
    id: Number(student.id),
    name: student.name || '',
    phone: student.phone || '',
    gender: student.gender || '',
    birthday: student.birthday || '',
    graduationDate: student.graduationDate || '',
    className: student.className || '',
    enrolledAt: student.enrolledAt || '',
    status: student.status || 'active',
    learningStage: VALID_STUDENT_LEARNING_STAGES.has(student.learningStage) ? student.learningStage : 'studying',
    archivedAt: student.archivedAt || null,
    remark: student.remark || ''
  })).filter((student) => Number.isInteger(student.id) && student.id > 0);
}

function normalizeHomeworkAssignments(assignments) {
  return assignments.map((assignment) => ({
    id: Number(assignment.id),
    homeworkName: assignment.homeworkName || '',
    className: assignment.className || '',
    dueDate: assignment.dueDate || '',
    description: assignment.description || '',
    createdAt: assignment.createdAt || '',
    createdByRole: assignment.createdByRole || '',
    createdByName: assignment.createdByName || '',
    deletedAt: assignment.deletedAt || ''
  })).filter((assignment) => Number.isInteger(assignment.id) && assignment.id > 0);
}

function normalizeHomeworkRecords(records) {
  return records.map((record) => ({
    ...record,
    id: Number(record.id),
    studentId: Number(record.studentId),
    assignmentId: record.assignmentId ? Number(record.assignmentId) : null,
    fileSize: record.fileSize ? Number(record.fileSize) : 0
  })).filter((record) => Number.isInteger(record.id) && record.id > 0);
}

function normalizeRecords(records, numericKey) {
  return records.map((record) => ({
    ...record,
    id: Number(record.id),
    [numericKey]: Number(record[numericKey])
  })).filter((record) => Number.isInteger(record.id) && record.id > 0);
}

function normalizeInterviewRecords(records) {
  return normalizeRecords(records, 'studentId').map((record) => ({
    ...record,
    scheduleId: record.scheduleId ? Number(record.scheduleId) : null,
    teacherId: record.teacherId ? Number(record.teacherId) : null,
    teacherName: record.teacherName || '',
    scheduleStatus: record.scheduleStatus || '',
    source: record.source || (record.scheduleId ? 'schedule' : 'manual'),
    transcriptFileName: record.transcriptFileName || '',
    transcriptFilePath: record.transcriptFilePath || '',
    transcriptFileSize: record.transcriptFileSize ? Number(record.transcriptFileSize) : 0,
    transcriptUploadedAt: record.transcriptUploadedAt || ''
  }));
}

function normalizeInterviewSchedules(records) {
  return normalizeRecords(records, 'studentId').map((record) => ({
    ...record,
    teacherId: record.teacherId ? Number(record.teacherId) : null,
    transcriptFileName: record.transcriptFileName || '',
    transcriptFilePath: record.transcriptFilePath || '',
    transcriptFileSize: record.transcriptFileSize ? Number(record.transcriptFileSize) : 0,
    transcriptUploadedAt: record.transcriptUploadedAt || ''
  }));
}

function normalizeAuthAccounts(accounts) {
  return accounts.map((account) => ({
    id: Number(account.id),
    username: account.username || '',
    password: account.password || '',
    passwordHash: account.passwordHash || '',
    role: account.role || 'student',
    studentId: account.studentId ? Number(account.studentId) : null,
    teacherId: account.teacherId ? Number(account.teacherId) : null,
    teacherName: account.teacherName || '',
    classNames: Array.isArray(account.classNames)
      ? account.classNames.map((className) => String(className || '').trim()).filter(Boolean)
      : [],
    participatesInScheduling: account.participatesInScheduling === true,
    status: account.status || 'active',
    createdAt: account.createdAt || '',
    passwordUpdatedAt: account.passwordUpdatedAt || ''
  })).filter((account) => Number.isInteger(account.id) && account.id > 0);
}

function normalizeClasses(classes, sources) {
  const byName = new Map();
  let nextSyntheticId = 1;
  for (const item of classes) {
    const className = String(item.className || item.name || '').trim();
    if (!className) continue;
    const record = {
      id: Number(item.id) || nextSyntheticId++,
      className,
      createdAt: item.createdAt || '',
      createdByRole: item.createdByRole || '',
      createdByName: item.createdByName || '',
      teacherIds: normalizeIdList(item.teacherIds),
      teacherUsernames: normalizeStringList(item.teacherUsernames)
    };
    byName.set(className, record);
  }
  nextSyntheticId = Array.from(byName.values()).reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

  for (const student of sources.students || []) {
    addClassName(byName, student.className, () => nextSyntheticId++);
  }
  for (const assignment of sources.homeworkAssignments || []) {
    addClassName(byName, assignment.className, () => nextSyntheticId++);
  }
  for (const record of sources.homeworkRecords || []) {
    addClassName(byName, record.className, () => nextSyntheticId++);
  }
  for (const account of sources.authAccounts || []) {
    for (const className of account.classNames || []) {
      const item = addClassName(byName, className, () => nextSyntheticId++);
      if (account.teacherId) addUnique(item.teacherIds, Number(account.teacherId));
      if (account.username) addUnique(item.teacherUsernames, account.username);
    }
  }

  return Array.from(byName.values())
    .map((item, index) => ({
      ...item,
      id: Number.isInteger(item.id) && item.id > 0 ? item.id : index + 1
    }))
    .sort((left, right) => left.id - right.id);
}

function addClassName(byName, value, nextId) {
  const className = String(value || '').trim();
  if (!className) return null;
  if (!byName.has(className)) {
    byName.set(className, {
      id: nextId(),
      className,
      createdAt: '',
      createdByRole: '',
      createdByName: '',
      teacherIds: [],
      teacherUsernames: []
    });
  }
  return byName.get(className);
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => Number(value)).filter((value, index, list) =>
    Number.isInteger(value) && value > 0 && list.indexOf(value) === index
  );
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || '').trim()).filter((value, index, list) =>
    value && list.indexOf(value) === index
  );
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function nextId(rawNextId, records) {
  const configured = Number(rawNextId);
  const maxExisting = records.reduce((max, record) => Math.max(max, Number(record.id) || 0), 0) + 1;
  if (Number.isInteger(configured) && configured > 0) {
    return Math.max(configured, maxExisting);
  }
  return maxExisting;
}

module.exports = { createDatabase, CURRENT_SCHEMA_VERSION };
