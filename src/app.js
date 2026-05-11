function createApp({ db }) {
  const sessions = new Map();

  return {
    createStudent(input) {
      if (!input.name || !input.phone) {
        throw new Error('name and phone are required');
      }

      const student = {
        id: db.nextStudentId++,
        name: input.name,
        phone: input.phone,
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

    archiveStudent(id) {
      const student = db.students.find((item) => item.id === id);
      if (!student) throw new Error('student not found');
      student.status = 'archived';
      student.archivedAt = new Date().toISOString();
      return student;
    },

    addHomeworkRecord(input) {
      const record = {
        id: db.nextHomeworkId++,
        studentId: input.studentId,
        homeworkName: input.homeworkName || '',
        className: input.className || '',
        submitStatus: input.submitStatus || 'pending',
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
      record.homeworkName = patch.homeworkName ?? record.homeworkName;
      record.className = patch.className ?? record.className;
      record.submitStatus = patch.submitStatus ?? record.submitStatus;
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
      const record = {
        id: db.nextInterviewId++,
        studentId: input.studentId,
        companyName: input.companyName || '',
        positionName: input.positionName || '',
        interviewAt: input.interviewAt || '',
        result: input.result || '',
        feedback: input.feedback || '',
        hiredStatus: input.hiredStatus || '',
        remark: input.remark || ''
      };
      db.interviewRecords.push(record);
      return record;
    },

    updateInterviewRecord(id, patch) {
      const record = db.interviewRecords.find((item) => item.id === id);
      if (!record) throw new Error('interview record not found');
      record.companyName = patch.companyName ?? record.companyName;
      record.positionName = patch.positionName ?? record.positionName;
      record.interviewAt = patch.interviewAt ?? record.interviewAt;
      record.result = patch.result ?? record.result;
      record.feedback = patch.feedback ?? record.feedback;
      record.hiredStatus = patch.hiredStatus ?? record.hiredStatus;
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
      const student = db.students.find((item) => item.id === input.studentId);
      if (!student) throw new Error('student not found');

      const schedule = {
        id: db.nextInterviewScheduleId++,
        studentId: input.studentId,
        studentName: student.name,
        teacherId: input.teacherId,
        teacherName: input.teacherName,
        companyName: input.companyName || '',
        positionName: input.positionName || '',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.status || 'scheduled',
        remark: input.remark || ''
      };
      assertScheduleTime(schedule);
      assertNoScheduleConflict(db.interviewSchedules, schedule);
      db.interviewSchedules.push(schedule);
      return schedule;
    },

    updateInterviewSchedule(id, patch) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');

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
      const student = db.students.find((item) => item.id === nextSchedule.studentId);
      if (!student) throw new Error('student not found');
      nextSchedule.studentName = student.name;
      nextSchedule.status = patch.status ?? (patch.startsAt || patch.endsAt ? 'rescheduled' : schedule.status);
      requireScheduleFields(nextSchedule);
      assertScheduleTime(nextSchedule);
      assertNoScheduleConflict(db.interviewSchedules, nextSchedule, id);
      Object.assign(schedule, nextSchedule);
      return schedule;
    },

    cancelInterviewSchedule(id) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
      schedule.status = 'cancelled';
      return schedule;
    },

    completeInterviewSchedule(id) {
      const schedule = db.interviewSchedules.find((item) => item.id === id);
      if (!schedule) throw new Error('schedule not found');
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
        .filter((schedule) => schedule.status !== 'cancelled')
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

    login({ username, password }) {
      const roleMap = {
        admin: { password: 'admin123', role: 'admin' },
        teacher: { password: 'teacher123', role: 'teacher' },
        student: { password: 'student123', role: 'student' }
      };
      const account = roleMap[username];
      if (!account || account.password !== password) {
        throw new Error('invalid credentials');
      }
      const token = `session-${sessions.size + 1}`;
      sessions.set(token, { role: account.role, username });
      return { token, role: account.role };
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
      return toCsv(rows);
    },

    exportHomeworkRecords(filters = {}) {
      const records = this.listHomeworkRecords(filters).items;
      const rows = [['作业名称', '学生ID', '班级/课程', '提交状态', '提交时间', '批改结果', '备注']];
      for (const record of records) {
        rows.push([record.homeworkName, record.studentId, record.className, record.submitStatus, record.submitAt, record.reviewResult, record.remark]);
      }
      return toCsv(rows);
    },

    exportInterviewRecords(filters = {}) {
      const records = this.listInterviewRecords(filters).items;
      const rows = [['公司', '岗位', '学生ID', '面试时间', '结果', '反馈', '入职状态', '备注']];
      for (const record of records) {
        rows.push([record.companyName, record.positionName, record.studentId, record.interviewAt, record.result, record.feedback, record.hiredStatus, record.remark]);
      }
      return toCsv(rows);
    }
  };
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

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

module.exports = { createApp };
