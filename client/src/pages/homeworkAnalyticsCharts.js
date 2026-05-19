const axisLabelColor = '#7d8ba1';
const axisLineColor = 'rgba(135, 151, 176, 0.28)';
const panelTextColor = '#edf6ff';
const mutedTextColor = '#9eb0c8';

export function buildCompletionOption(overview) {
  const submitted = Number(overview?.submittedCount || 0);
  const pending = Number(overview?.pendingCount || 0);
  const rate = clampPercent(overview?.completionRate);

  return {
    color: ['#30d6a3', '#f59e0b'],
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 条 ({d}%)'
    },
    series: [
      {
        name: '总体完成率',
        type: 'pie',
        radius: ['68%', '86%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderColor: '#101725',
          borderWidth: 4
        },
        label: {
          show: true,
          position: 'center',
          formatter: `{rate|${rate}%}\n{name|完成率}`,
          rich: {
            rate: {
              color: panelTextColor,
              fontSize: 34,
              fontWeight: 800,
              lineHeight: 42
            },
            name: {
              color: mutedTextColor,
              fontSize: 13,
              fontWeight: 700
            }
          }
        },
        labelLine: { show: false },
        data: [
          { value: submitted, name: '已交' },
          { value: pending, name: '未交' }
        ]
      }
    ]
  };
}

export function buildAssignmentOption(assignments) {
  const items = [...(assignments || [])].slice(0, 8).reverse();
  return {
    grid: { top: 18, right: 22, bottom: 28, left: 80 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params) {
        const item = params?.[0]?.data?.raw;
        if (!item) return '';
        return `${item.homeworkName}<br/>班级：${item.className || '-'}<br/>已交：${item.submittedCount}/${item.totalCount}<br/>完成率：${item.completionRate}%`;
      }
    },
    xAxis: {
      type: 'value',
      max: 100,
      splitLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, formatter: '{value}%' }
    },
    yAxis: {
      type: 'category',
      data: items.map((item) => shorten(item.homeworkName, 8)),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: panelTextColor, fontWeight: 700 }
    },
    series: [
      {
        name: '完成率',
        type: 'bar',
        barWidth: 14,
        itemStyle: {
          borderRadius: [0, 7, 7, 0],
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: '#2dd4bf' },
              { offset: 1, color: '#60a5fa' }
            ]
          }
        },
        label: {
          show: true,
          position: 'right',
          color: mutedTextColor,
          formatter: ({ value }) => `${value}%`
        },
        data: items.map((item) => ({
          value: clampPercent(item.completionRate),
          raw: item
        }))
      }
    ]
  };
}

export function buildClassOption(classes) {
  const items = [...(classes || [])]
    .sort((left, right) => Number(right.completionRate || 0) - Number(left.completionRate || 0))
    .slice(0, 7);

  return {
    grid: { top: 28, right: 16, bottom: 46, left: 36 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params) {
        const item = params?.[0]?.data?.raw;
        if (!item) return '';
        return `${item.className || '未填写班级'}<br/>在读：${item.studentCount} 人<br/>已交：${item.submittedCount}/${item.recordCount}<br/>完成率：${item.completionRate}%`;
      }
    },
    xAxis: {
      type: 'category',
      data: items.map((item) => shorten(item.className || '未填写', 6)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontWeight: 700, interval: 0 }
    },
    yAxis: {
      type: 'value',
      max: 100,
      splitLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, formatter: '{value}%' }
    },
    series: [
      {
        name: '完成率',
        type: 'bar',
        barWidth: 24,
        itemStyle: {
          borderRadius: [7, 7, 0, 0],
          color: {
            type: 'linear',
            x: 0,
            y: 1,
            x2: 0,
            y2: 0,
            colorStops: [
              { offset: 0, color: '#8b5cf6' },
              { offset: 1, color: '#22c55e' }
            ]
          }
        },
        label: {
          show: true,
          position: 'top',
          color: panelTextColor,
          formatter: ({ value }) => `${value}%`
        },
        data: items.map((item) => ({
          value: clampPercent(item.completionRate),
          raw: item
        }))
      }
    ]
  };
}

export function buildStudentDistributionOption(students) {
  const buckets = [
    { name: '0-59%', min: 0, max: 59, value: 0 },
    { name: '60-79%', min: 60, max: 79, value: 0 },
    { name: '80-99%', min: 80, max: 99, value: 0 },
    { name: '100%', min: 100, max: 100, value: 0 }
  ];

  for (const student of students || []) {
    const rate = clampPercent(student.completionRate);
    const bucket = buckets.find((item) => rate >= item.min && rate <= item.max);
    if (bucket) bucket.value += 1;
  }

  return {
    color: ['#f97316', '#facc15', '#38bdf8', '#34d399'],
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 人'
    },
    legend: {
      bottom: 0,
      textStyle: { color: mutedTextColor, fontWeight: 700 }
    },
    series: [
      {
        name: '学生分布',
        type: 'pie',
        radius: ['44%', '70%'],
        center: ['50%', '42%'],
        itemStyle: {
          borderColor: '#101725',
          borderWidth: 3
        },
        label: {
          color: panelTextColor,
          formatter: '{b}\n{c} 人'
        },
        data: buckets.map(({ name, value }) => ({ name, value }))
      }
    ]
  };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function shorten(value, size) {
  const text = String(value || '');
  return text.length > size ? `${text.slice(0, size)}...` : text;
}
