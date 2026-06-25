let stationsMap = {};
window.trainTypeMap = {};
window.processedTrains = [];

const colorPalette = {
    "普悠瑪": "#FF5252",
    "太魯閣": "#FFA726",
    "新自強": "#ce6be0",
    "PP自強": "#5ad362",
    "柴聯自強": "#baff66",
    "莒光": "#FFEE58",
    "區間快": "#5b7cfe",
    "區間": "#00ffff"
};

function getTrainTypeName(train, number) {
    const trainMapping = {
        6094: '鳴日號', 6011: '鳴日號', 6006: '鳴日號', 6007: '鳴日號', 6022: '鳴日號',
        6010: '鳴日號', 6081: '鳴日號', 6057: '鳴日號', 6088: '鳴日號', 6090: '鳴日號',
        6099: '鳴日號', 6050: '鳴日號', 6075: '鳴日號',
        5898: '藍皮解憂', 5899: '藍皮解憂',
        6629: '海風號', 6630: '海風號', 6637: '海風號', 6638: '海風號', 6652: '海風號', 6655: '海風號',
        6631: '山嵐號', 6632: '山嵐號', 6633: '山嵐號', 6676: '山嵐號', 6677: '山嵐號',
        1: '環島之星', 2: '環島之星',
        6611: '慧燈專車', 6615: '慧燈專車', 6616: '慧燈專車'
    };
    const numKey = Number(number);
    if (trainMapping[numKey]) {
        return `${trainMapping[numKey]} ${numKey}`;
    }
    return train ? `${train} ${numKey}` : `${numKey}`;
}

async function init() {
    try {
        const now = new Date();
        const logicalToday = new Date(now.getTime() - 5 * 3600 * 1000);

        const targetDate = new Date(logicalToday);
        targetDate.setDate(targetDate.getDate() - 3);

        const yyyy = targetDate.getFullYear();
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        document.getElementById('date-input').value = `${yyyy}-${mm}-${dd}`;

        const res = await fetch('stations.json');
        const stations = await res.json();
        stations.forEach(s => {
            stationsMap[s.stationCode] = s.stationName;
        });
        
        // Add special station '枋野' which is not in stations.json
        stationsMap['5170'] = '枋野';
    } catch (e) {
        console.error("Failed to load stations.json", e);
    }

    // Auto-fetch data on load
    await fetchData(false);
}

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
}

async function fetchData(showError = true) {
    const dateVal = document.getElementById('date-input').value;
    if (!dateVal) {
        if (showError) alert("請選擇日期");
        return;
    }
    const dateStr = dateVal.substring(5).replace('-', '');
    const fullDateStr = dateVal.replace(/-/g, '');

    const wrapper = document.getElementById('charts-wrapper');
    wrapper.innerHTML = "<p style='color: #00f0ff;'>資料載入中，請稍候...</p>";
    document.getElementById('overview-chart-container').style.display = 'none';

    try {
        const [resTdx, resSchedule] = await Promise.allSettled([
            fetch(`https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/merged_train_data_${dateStr}.json`),
            fetch(`https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${fullDateStr}.json`)
        ]);

        if (resTdx.status === 'rejected' || !resTdx.value.ok) throw new Error("資料獲取失敗，請確認該日期有歷史資料。");
        const data = await resTdx.value.json();

        let scheduleMap = {};
        if (resSchedule.status === 'fulfilled' && resSchedule.value.ok) {
            try {
                const sData = await resSchedule.value.json();
                sData.forEach(t => { scheduleMap[t.number] = t; });
            } catch (e) { }
        }
        window.trainTypeMap = scheduleMap;

        wrapper.innerHTML = "";

        if (!data || data.length === 0) {
            wrapper.innerHTML = "<p style='color: #ef4444;'>無此日期的資料</p>";
            return;
        }

        let maxDelay = 0;
        const processedData = [];

        data.forEach(train => {
            if (!train.data || train.data.length === 0) return;

            // 1. Sort data chronologically relative to the first record
            let baseTime = parseTime(train.data[0].Update);
            train.data.forEach(d => {
                let rawTime = parseTime(d.Update);
                // If time drops by more than 6 hours, it crossed midnight into the next day
                if (rawTime < baseTime - 6 * 3600) {
                    d._absTime = rawTime + 24 * 3600;
                }
                // If time jumps by more than 18 hours, it's a leftover record from yesterday
                else if (rawTime > baseTime + 18 * 3600) {
                    d._absTime = rawTime - 24 * 3600;
                }
                else {
                    d._absTime = rawTime;
                }
            });
            train.data.sort((a, b) => a._absTime - b._absTime);

            // 2. Group by consecutive stations
            const groups = [];
            for (let i = 0; i < train.data.length; i++) {
                const d = train.data[i];
                if (groups.length === 0 || groups[groups.length - 1].StationID !== d.StationID) {
                    groups.push({ StationID: d.StationID, records: [d] });
                } else {
                    groups[groups.length - 1].records.push(d);
                }
            }

            // 3. Keep last record of origin, and first record of subsequent stations
            const uniqueData = [];
            const seenStations = new Set();
            groups.forEach((g, index) => {
                if (seenStations.has(g.StationID)) return;
                seenStations.add(g.StationID);

                if (index === 0) {
                    uniqueData.push(g.records[g.records.length - 1]);
                } else {
                    uniqueData.push(g.records[0]);
                }
            });

            uniqueData.forEach(d => {
                if (d.Delay > maxDelay) {
                    maxDelay = d.Delay;
                }
            });

            if (uniqueData.length > 0) {
                processedData.push({ ...train, data: uniqueData });
            }
        });

        processedData.sort((a, b) => parseInt(a.No, 10) - parseInt(b.No, 10));

        const yAxisMax = Math.ceil(maxDelay * 1.1) || 10;
        window.processedTrains = processedData;

        const overviewDatasets = [];

        processedData.forEach(train => {
            const trainData = window.trainTypeMap[train.No];
            const tType = trainData?.train || "";
            const neonColor = colorPalette[tType] || "#64748b";

            const container = document.createElement('div');
            container.className = 'chart-container';
            container.id = `chart-train-${train.No}`;
            container.style.overflow = 'hidden';

            const title = document.createElement('h2');
            title.className = 'chart-title';

            let titleHTML = `<span style="color: ${neonColor}; text-shadow: 0 0 8px ${neonColor};">${getTrainTypeName(tType, train.No)}</span>`;
            if (trainData && trainData.info && trainData.info.start && trainData.info.end) {
                const sData = trainData.data || [];
                const startTime = sData.length > 0 ? sData[0].dep : "";
                const endTime = sData.length > 0 ? sData[sData.length - 1].arr : "";

                let startStr = startTime ? `${startTime} ` : "";
                let endStr = endTime ? `${endTime} ` : "";

                titleHTML += ` <span style="color: #94a3b8; font-size: 0.85em; font-weight: normal; text-shadow: none;">${startStr}${trainData.info.start} → ${endStr}${trainData.info.end}</span>`;
            }
            title.innerHTML = titleHTML;

            container.appendChild(title);

            let firstTime = parseTime(train.data[0].Update);

            const chartData = [];
            const xTicks = [];
            const timeToStation = {};

            train.data.forEach(d => {
                let sName = stationsMap[d.StationID] || d.StationID;
                let currentTime = parseTime(d.Update);

                // Handle cross midnight
                if (currentTime < firstTime - 12 * 3600) {
                    currentTime += 24 * 3600;
                }

                let timeSinceDep = (currentTime - firstTime) / 60; // in minutes

                chartData.push({ x: timeSinceDep, y: d.Delay });
                timeToStation[timeSinceDep] = sName;
                xTicks.push(timeSinceDep);
            });

            let maxTime = Math.max(...xTicks);
            let targetWidthPercent = Math.max(100, (maxTime / 480) * 100);

            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'history-chart-scroll-container';
            scrollContainer.style.overflowX = 'auto';
            scrollContainer.style.overflowY = 'hidden';
            scrollContainer.style.height = 'calc(100% - 40px)';
            scrollContainer.style.width = '100%';

            const canvasWrapper = document.createElement('div');
            canvasWrapper.style.position = 'relative';
            canvasWrapper.style.height = '100%';
            canvasWrapper.style.width = `${targetWidthPercent}%`;

            const canvas = document.createElement('canvas');
            canvasWrapper.appendChild(canvas);
            scrollContainer.appendChild(canvasWrapper);
            container.appendChild(scrollContainer);
            wrapper.appendChild(container);

            overviewDatasets.push({
                label: getTrainTypeName(tType, train.No),
                data: chartData,
                borderColor: neonColor,
                backgroundColor: 'transparent',
                borderWidth: 1,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 0,
                pointHitRadius: 5,
                clip: false
            });

            new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: [{
                        label: '誤點時間 (分鐘)',
                        data: chartData,
                        borderColor: neonColor,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.1,
                        pointBackgroundColor: function (context) {
                            if (context.raw === undefined) return '#00ffaa';
                            const delay = context.raw.y;
                            if (delay === 0) return '#00ffaa';
                            if (delay <= 5) return '#ff9900';
                            if (delay <= 20) return '#ff0055';
                            return '#cc38e6';
                        },
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBorderWidth: 0,
                        clip: false
                    }]
                },
                options: {
                    layout: {
                        padding: {
                            top: 10,
                            bottom: 15,
                            left: 10,
                            right: 20
                        }
                    },
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            min: 0,
                            max: Math.max(480, maxTime),
                            title: {
                                display: true,
                                text: '停靠站',
                                color: '#d0ffe6',
                                font: {
                                    size: 14,
                                    family: "'Courier New', Courier, monospace"
                                }
                            },
                            grid: {
                                color: 'rgba(208, 255, 230, 0.1)'
                            },
                            afterBuildTicks: axis => {
                                axis.ticks = xTicks.map(v => ({ value: v }));
                            },
                            ticks: {
                                color: '#94a3b8',
                                maxRotation: 45,
                                minRotation: 45,
                                callback: function (value) {
                                    return timeToStation[value] || value;
                                }
                            }
                        },
                        y: {
                            min: 0,
                            max: yAxisMax,
                            title: {
                                display: true,
                                text: '誤點時間 (分)',
                                color: '#d0ffe6',
                                font: {
                                    size: 14,
                                    family: "'Courier New', Courier, monospace"
                                }
                            },
                            grid: {
                                color: 'rgba(208, 255, 230, 0.1)'
                            },
                            ticks: {
                                color: '#94a3b8'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(13, 21, 38, 0.9)',
                            titleColor: '#00f0ff',
                            bodyColor: '#e2e8f0',
                            borderColor: '#1e293b',
                            borderWidth: 1,
                            callbacks: {
                                title: function (context) {
                                    let xVal = context[0].parsed.x;
                                    return '車站: ' + (timeToStation[xVal] || xVal);
                                }
                            }
                        }
                    }
                }
            });
        });

        // Draw overview chart
        document.getElementById('overview-chart-container').style.display = 'block';
        if (window.overviewChart) window.overviewChart.destroy();
        window.overviewChart = new Chart(document.getElementById('overview-canvas'), {
            type: 'line',
            data: { datasets: overviewDatasets },
            options: {
                animation: false,
                normalized: true,
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'point',
                    intersect: true
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        title: { display: true, text: '發車後時間 (時:分)', color: '#d0ffe6' },
                        grid: { color: 'rgba(208, 255, 230, 0.1)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: function (value) {
                                const h = Math.floor(value / 60);
                                const m = Math.floor(value % 60);
                                return `${h}:${m.toString().padStart(2, '0')}`;
                            }
                        }
                    },
                    y: {
                        min: 0,
                        max: yAxisMax,
                        title: { display: true, text: '誤點時間 (分)', color: '#d0ffe6' },
                        grid: { color: 'rgba(208, 255, 230, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(13, 21, 38, 0.9)',
                        titleColor: '#00f0ff',
                        bodyColor: '#e2e8f0',
                        borderColor: '#1e293b',
                        borderWidth: 1,
                        displayColors: true,
                        callbacks: {
                            title: function () { return ''; },
                            label: function (context) {
                                return context.dataset.label;
                            }
                        }
                    }
                }
            }
        });

    } catch (e) {
        if (showError) {
            wrapper.innerHTML = `<p style='color: #ef4444;'>錯誤: ${e.message}</p>`;
        } else {
            wrapper.innerHTML = "";
            document.getElementById('overview-chart-container').style.display = 'none';
        }
    }
}

document.getElementById('fetch-btn').addEventListener('click', () => fetchData(true));

document.getElementById('date-input').addEventListener('change', () => fetchData(false));

document.getElementById('date-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        fetchData(true);
    }
});

const searchInput = document.getElementById('train-search-input');
const suggestionsBox = document.getElementById('train-suggestions');

searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (!query || !window.processedTrains) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const matches = window.processedTrains.filter(t => String(t.No).includes(query));
    if (matches.length > 0) {
        suggestionsBox.innerHTML = matches.map(t => {
            const trainData = window.trainTypeMap[t.No];
            const tType = trainData?.train || "";
            const neonColor = colorPalette[tType] || "#64748b";

            let displayName = `<span style="color: ${neonColor};">${getTrainTypeName(tType, t.No)}</span>`;
            if (trainData && trainData.info && trainData.info.start && trainData.info.end) {
                const sData = trainData.data || [];
                const startTime = sData.length > 0 ? sData[0].dep : "";
                const endTime = sData.length > 0 ? sData[sData.length - 1].arr : "";

                let startStr = startTime ? `${startTime} ` : "";
                let endStr = endTime ? `${endTime} ` : "";

                displayName += ` <span style="color: #94a3b8; font-size: 0.9em;">${startStr}${trainData.info.start} → ${endStr}${trainData.info.end}</span>`;
            }
            return `<div class="suggestion-item" data-no="${t.No}">${displayName}</div>`;
        }).join('');
        suggestionsBox.style.display = 'block';

        suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const trainNo = item.getAttribute('data-no');
                searchInput.value = trainNo;
                suggestionsBox.style.display = 'none';
                jumpToTrain(trainNo);
            });
        });
    } else {
        suggestionsBox.style.display = 'none';
    }
});

document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== suggestionsBox) {
        suggestionsBox.style.display = 'none';
    }
});

function jumpToTrain(trainNo) {
    if (!trainNo) return;
    const target = document.getElementById(`chart-train-${trainNo}`);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.transition = 'box-shadow 0.3s ease';
        target.style.boxShadow = '0 0 20px #00f0ff';
        setTimeout(() => {
            target.style.boxShadow = 'none';
        }, 2000);
        document.getElementById('train-search-input').value = '';
    } else {
        alert("找不到指定的車次圖表");
    }
}

document.getElementById('search-btn').addEventListener('click', () => {
    jumpToTrain(searchInput.value.trim());
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        jumpToTrain(searchInput.value.trim());
        suggestionsBox.style.display = 'none';
    }
});

// Initialize
init();
