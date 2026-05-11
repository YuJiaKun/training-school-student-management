function createApp({ db }) {
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

    listStudents(filters = {}) {
      const items = db.students.filter((student) => {
        if (filters.status && student.status !== filters.status) return false;
        if (filters.keyword) {
          const text = `${student.name} ${student.phone}`;
          if (!text.includes(filters.keyword)) return false;
        }
        if (filters.className && student.className !== filters.className) return false;
        return true;
      });

      return { items, total: items.length };
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

    listInterviewRecords(filters = {}) {
      const items = db.interviewRecords.filter((record) => {
        if (filters.studentId && record.studentId !== Number(filters.studentId)) return false;
        if (filters.companyName && !record.companyName.includes(filters.companyName)) return false;
        if (filters.result && record.result !== filters.result) return false;
        return true;
      });
      return { items, total: items.length };
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
