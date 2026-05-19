const axisLabelColor = '#7d8ba1';
const axisLineColor = 'rgba(135, 151, 176, 0.28)';
const panelTextColor = '#edf6ff';
const mutedTextColor = '#9eb0c8';

export function buildEmploymentOption(stats) {
  const hired = Number(stats?.hiredStatuses?.hired || 0);
  const total = Number(stats?.interviews?.total || 0);
  const pending = Math.max(0, total - hired);
  const rate = clampPercent(stats?.employmentRate);

  return {
    color: ['#34d399', '#334155'],
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 条 ({d}%)'
    },
    series: [
      {
        name: '就业率',
        type: 'pie',
        radius: ['68%', '86%'],
        center: ['50%', '50%'],
        itemStyle: {
          borderColor: '#101725',
          borderWidth: 4
        },
        label: {
          show: true,
          position: 'center',
          formatter: `{rate|${rate}%}\n{name|就业率}`,
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
          { value: hired, name: '已入职' },
          { value: pending, name: '未入职/待定' }
        ]
      }
    ]
  };
}

export function buildInterviewResultOption(results = {}) {
  const items = [
    { name: '待反馈', value: Number(results.pending || 0), color: '#f59e0b' },
    { name: '已通过', value: Number(results.passed || 0), color: '#34d399' },
    { name: '未通过', value: Number(results.failed || 0), color: '#f87171' }
  ];

  return {
    grid: { top: 28, right: 18, bottom: 36, left: 42 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: items.map((item) => item.name),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontWeight: 700 }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor }
    },
    series: [
      {
        name: '面试结果',
        type: 'bar',
        barWidth: 28,
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: ({ data }) => data.color
        },
        label: {
          show: true,
          position: 'top',
          color: panelTextColor,
          fontWeight: 700
        },
        data: items
      }
    ]
  };
}

export function buildHiredStatusOption(statuses = {}) {
  return {
    color: ['#facc15', '#34d399', '#60a5fa'],
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 条 ({d}%)'
    },
    legend: {
      bottom: 0,
      textStyle: { color: mutedTextColor, fontWeight: 700 }
    },
    series: [
      {
        name: '入职状态',
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '42%'],
        itemStyle: {
          borderColor: '#101725',
          borderWidth: 3
        },
        label: {
          color: panelTextColor,
          formatter: '{b}\n{c} 条'
        },
        data: [
          { name: '待定', value: Number(statuses.pending || 0) },
          { name: '已入职', value: Number(statuses.hired || 0) },
          { name: '未入职', value: Number(statuses.not_hired || 0) }
        ]
      }
    ]
  };
}

export function buildInterviewTrendOption(interviews = []) {
  const buckets = new Map();
  for (const item of interviews || []) {
    const day = String(item.interviewAt || '').slice(0, 10) || '未设置';
    buckets.set(day, (buckets.get(day) || 0) + 1);
  }
  const items = Array.from(buckets.entries()).sort((left, right) => left[0].localeCompare(right[0])).slice(-7);

  return {
    grid: { top: 26, right: 18, bottom: 36, left: 42 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: items.map(([day]) => day.slice(5) || day),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontWeight: 700 }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor }
    },
    series: [
      {
        name: '面试数',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, color: '#22d3ee' },
        itemStyle: { color: '#22d3ee' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(34, 211, 238, 0.32)' },
              { offset: 1, color: 'rgba(34, 211, 238, 0.02)' }
            ]
          }
        },
        data: items.map(([, value]) => value)
      }
    ]
  };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}
