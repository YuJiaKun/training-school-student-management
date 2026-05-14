const fs = require('node:fs');
const path = require('node:path');

const CURRENT_SCHEMA_VERSION = 2;

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
    authAccounts: state.authAccounts,
    nextStudentId: state.nextStudentId,
    nextHomeworkAssignmentId: state.nextHomeworkAssignmentId,
    nextHomeworkId: state.nextHomeworkId,
    nextInterviewId: state.nextInterviewId,
    nextInterviewScheduleId: state.nextInterviewScheduleId,
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
        authAccounts: this.authAccounts,
        nextStudentId: this.nextStudentId,
        nextHomeworkAssignmentId: this.nextHomeworkAssignmentId,
        nextHomeworkId: this.nextHomeworkId,
        nextInterviewId: this.nextInterviewId,
        nextInterviewScheduleId: this.nextInterviewScheduleId,
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
    authAccounts: [],
    nextStudentId: 1,
    nextHomeworkAssignmentId: 1,
    nextHomeworkId: 1,
    nextInterviewId: 1,
    nextInterviewScheduleId: 1,
    nextAuthAccountId: 1
  };
}

function normalizeState(raw) {
  const students = normalizeStudents(raw.students || []);
  const homeworkAssignments = normalizeHomeworkAssignments(raw.homeworkAssignments || []);
  const homeworkRecords = normalizeHomeworkRecords(raw.homeworkRecords || []);
  const interviewRecords = normalizeRecords(raw.interviewRecords || [], 'studentId');
  const interviewSchedules = normalizeRecords(raw.interviewSchedules || [], 'studentId');
  const authAccounts = normalizeAuthAccounts(raw.authAccounts || []);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    students,
    homeworkAssignments,
    homeworkRecords,
    interviewRecords,
    interviewSchedules,
    authAccounts,
    nextStudentId: nextId(raw.nextStudentId, students),
    nextHomeworkAssignmentId: nextId(raw.nextHomeworkAssignmentId, homeworkAssignments),
    nextHomeworkId: nextId(raw.nextHomeworkId, homeworkRecords),
    nextInterviewId: nextId(raw.nextInterviewId, interviewRecords),
    nextInterviewScheduleId: nextId(raw.nextInterviewScheduleId, interviewSchedules),
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
    className: student.className || '',
    enrolledAt: student.enrolledAt || '',
    status: student.status || 'active',
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
    createdByName: assignment.createdByName || ''
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

function normalizeAuthAccounts(accounts) {
  return accounts.map((account) => ({
    id: Number(account.id),
    username: account.username || '',
    password: account.password || '',
    role: account.role || 'student',
    studentId: account.studentId ? Number(account.studentId) : null,
    teacherId: account.teacherId ? Number(account.teacherId) : null,
    status: account.status || 'active',
    createdAt: account.createdAt || ''
  })).filter((account) => Number.isInteger(account.id) && account.id > 0);
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
