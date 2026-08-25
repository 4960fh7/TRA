let stationsMap = {};
window.trainTypeMap = {};
window.processedTrains = [];
window.currentViewMode = 'train';
window.yAxisMax = 10;
window.overviewChart = null;

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
        4666: '仲夏寶島', 4667: '仲夏寶島',
        1: '環島之星', 2: '環島之星',
        6611: '慧燈專車', 6615: '慧燈專車', 6616: '慧燈專車'
    };
    const numKey = Number(number);
    if (trainMapping[numKey]) {
        return `${trainMapping[numKey]} ${numKey}`;
    }
    return train ? `${train} ${numKey}` : `${numKey}`;
}

function closeMobileSearchForm() {
    const form = document.getElementById('mobile-search-form');
    const toggle = document.getElementById('mobile-search-toggle');
    if (form && form.classList.contains('show')) {
        form.classList.remove('show');
        if (toggle) toggle.innerHTML = '搜尋設定 ▼';
    }
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
        const dateStr = `${yyyy}-${mm}-${dd}`;
        document.getElementById('start-date-input').value = dateStr;
        document.getElementById('end-date-input').value = dateStr;

        const res = await fetch('stations.json');
        const stations = await res.json();
        window.globalStationsData = stations; // Added for map rendering
        window.stationsLevelMap = {};
        stations.forEach(s => {
            stationsMap[s.stationCode] = s.stationName;
            window.stationsLevelMap[s.stationCode] = s.level;
        });

        // Add special station '枋野' which is not in stations.json
        stationsMap['5170'] = '枋野';

        try {
            const mapRes = await fetch('counties.json');
            window.countiesData = await mapRes.json();
        } catch(e) { console.error("Failed to load counties.json", e); }

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
    const startVal = document.getElementById('start-date-input').value;
    const endVal = document.getElementById('end-date-input').value;
    if (!startVal || !endVal) {
        if (showError) alert("請選擇日期區間");
        return;
    }
    
    let startDate = new Date(startVal);
    let endDate = new Date(endVal);
    
    if (startDate > endDate) {
        if (showError) alert("開始日期不能晚於結束日期");
        return;
    }
    
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays > 6) { 
        if (showError) alert("區間最多只能選擇 7 天");
        return;
    }

    const wrapper = document.getElementById('charts-wrapper');
    wrapper.innerHTML = "<p style='color: #00f0ff;'>資料載入中，請稍候...</p>";
    document.getElementById('overview-chart-container').style.display = 'none';

    try {
        let scheduleMap = {};
        let maxDelay = 0;
        const allProcessedDataMap = {};

        let currDate = new Date(startDate);
        const dateObjects = [];
        while (currDate <= endDate) {
            const yyyy = currDate.getFullYear();
            const mm = String(currDate.getMonth() + 1).padStart(2, '0');
            const dd = String(currDate.getDate()).padStart(2, '0');
            dateObjects.push({ str: `${yyyy}${mm}${dd}`, label: `${mm}/${dd}` });
            currDate.setDate(currDate.getDate() + 1);
        }
        
        window.activeDateObjects = dateObjects;
        const slider = document.getElementById('time-slider');
        if (slider) {
            slider.min = 300;
            slider.max = 300 + (dateObjects.length * 1440) - 5; // e.g. 1 day = max 1735 (28:55)
            slider.value = 300;
        }
        const dateDisplay = document.getElementById('date-display');
        if (dateDisplay) dateDisplay.innerText = dateObjects[0].label;

        for (let i = 0; i < dateObjects.length; i++) {
            const dateStr = dateObjects[i].str;
            const dateLabel = dateObjects[i].label;
            
            const [resTdx, resSchedule] = await Promise.allSettled([
                fetch(`https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/merged_train_data_${dateStr}.json`),
                fetch(`https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${dateStr}.json`)
            ]);
            
            if (resSchedule.status === 'fulfilled' && resSchedule.value.ok) {
                try {
                    const sData = await resSchedule.value.json();
                    sData.forEach(t => { scheduleMap[t.number] = t; });
                } catch (e) {}
            }
            
            if (resTdx.status === 'fulfilled' && resTdx.value.ok) {
                try {
                    const data = await resTdx.value.json();
                    data.forEach(train => {
                        if (!train.data || train.data.length === 0) return;

                        let baseTime = parseTime(train.data[0].Update);
                        train.data.forEach(d => {
                            let rawTime = parseTime(d.Update);
                            if (rawTime < baseTime - 6 * 3600) {
                                d._absTime = rawTime + 24 * 3600;
                            } else if (rawTime > baseTime + 18 * 3600) {
                                d._absTime = rawTime - 24 * 3600;
                            } else {
                                d._absTime = rawTime;
                            }
                        });
                        train.data.sort((a, b) => a._absTime - b._absTime);

                        const groups = [];
                        for (let j = 0; j < train.data.length; j++) {
                            const d = train.data[j];
                            if (groups.length === 0 || groups[groups.length - 1].StationID !== d.StationID) {
                                groups.push({ StationID: d.StationID, records: [d] });
                            } else {
                                groups[groups.length - 1].records.push(d);
                            }
                        }

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
                            if (!allProcessedDataMap[train.No]) {
                                allProcessedDataMap[train.No] = { No: train.No, daysData: [] };
                            }
                            allProcessedDataMap[train.No].daysData.push({ dateLabel: dateLabel, data: uniqueData });
                        }
                    });
                } catch(e) {}
            }
        }

        window.trainTypeMap = scheduleMap;

        const processedData = Object.values(allProcessedDataMap);
        processedData.sort((a, b) => parseInt(a.No, 10) - parseInt(b.No, 10));

        wrapper.innerHTML = "";
        
        if (processedData.length === 0) {
            wrapper.innerHTML = "<p style='color: #ef4444;'>此區間無資料</p>";
            return;
        }

        window.yAxisMax = Math.ceil(Math.max(10, maxDelay * 1.1) / 5) * 5;
        window.processedTrains = processedData;

        renderCharts();
        closeMobileSearchForm();

    } catch (e) {
        if (showError) {
            wrapper.innerHTML = `<p style='color: #ef4444;'>錯誤: ${e.message}</p>`;
        } else {
            wrapper.innerHTML = "";
            document.getElementById('overview-chart-container').style.display = 'none';
        }
    }
}

function renderCharts() {
    const wrapper = document.getElementById('charts-wrapper');
    wrapper.innerHTML = "";
    document.getElementById('overview-chart-container').style.display = 'none';

    if (window.overviewChart) {
        window.overviewChart.destroy();
        window.overviewChart = null;
    }

    if (!window.processedTrains || window.processedTrains.length === 0) return;

    if (window.currentViewMode === 'train') {
        renderTrainCharts();
    } else {
        renderStationCharts();
    }
}

function renderTrainCharts() {
    const wrapper = document.getElementById('charts-wrapper');
    const overviewDatasets = [];

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                if (container._renderChart) {
                    container._renderChart();
                    delete container._renderChart;
                }
                obs.unobserve(container);
            }
        });
    }, { rootMargin: '200px' });

    window.processedTrains.forEach(train => {
        const trainData = window.trainTypeMap[train.No];
        const tType = trainData?.train || "";
        const neonColor = colorPalette[tType] || "#64748b";

        let titleHTML = `<span style="color: ${neonColor}; text-shadow: 0 0 8px ${neonColor};">${getTrainTypeName(tType, train.No)}</span>`;
        if (trainData && trainData.info && trainData.info.start && trainData.info.end) {
            const sData = trainData.data || [];
            const startTime = sData.length > 0 ? sData[0].dep : "";
            const endTime = sData.length > 0 ? sData[sData.length - 1].arr : "";

            let startStr = startTime ? `${startTime} ` : "";
            let endStr = endTime ? `${endTime} ` : "";

            titleHTML += ` <span style="color: #94a3b8; font-size: 0.85em; font-weight: normal; text-shadow: none;">${startStr}${trainData.info.start} → ${endStr}${trainData.info.end}</span>`;
        }

        const allDatasets = [];
        let baseDayData = train.daysData[0].data; // Use the first available day to build x-axis ticks
        let stationNodes = [];
        let timeToStation = {};
        let xTicks = [];
        let totalDelay = 0;
        let localMaxDelay = 0;
        let totalCount = 0;

        let baseFirstTime = parseTime(baseDayData[0].Update);
        baseDayData.forEach(d => {
            let sid = d.StationID;
            let sName = stationsMap[sid] || sid;
            let currentTime = parseTime(d.Update);
            if (currentTime < baseFirstTime - 12 * 3600) {
                currentTime += 24 * 3600;
            }
            let timeSinceDep = (currentTime - baseFirstTime) / 60;
            timeToStation[timeSinceDep] = sName;
            xTicks.push(timeSinceDep);

            let level = (window.stationsLevelMap && window.stationsLevelMap[sid] !== undefined) ? window.stationsLevelMap[sid] : 999;
            stationNodes.push({ time: timeSinceDep, name: sName, level: level, sid: sid });
        });

        // Compute datasets for each day
        const stationDelays = {}; // For overview chart avg
        train.daysData.forEach(day => {
            let firstTime = parseTime(day.data[0].Update);
            const chartData = [];
            
            day.data.forEach(d => {
                let sid = d.StationID;
                let sName = stationsMap[sid] || sid;
                let currentTime = parseTime(d.Update);
                if (currentTime < firstTime - 12 * 3600) {
                    currentTime += 24 * 3600;
                }
                let timeSinceDep = (currentTime - firstTime) / 60;

                chartData.push({ x: timeSinceDep, y: d.Delay, dateLabel: day.dateLabel, stationName: sName });
                
                totalDelay += d.Delay;
                totalCount++;
                if (d.Delay > localMaxDelay) localMaxDelay = d.Delay;

                // For overview chart
                if (!stationDelays[sid]) stationDelays[sid] = { totalTime: 0, totalDelay: 0, count: 0, stationName: sName };
                stationDelays[sid].totalTime += timeSinceDep;
                stationDelays[sid].totalDelay += d.Delay;
                stationDelays[sid].count++;
            });

            allDatasets.push({
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
                    return '#ce6be0';
                },
                pointBorderWidth: 0,
                pointRadius: 1.5,
                pointHoverRadius: 2.5,
                clip: false
            });
        });

        stationNodes.sort((a, b) => a.time - b.time);
        let level0Nodes = stationNodes.filter(n => n.level === 0);
        let finalSelection = [];
        let lastSelectedTime = -999;

        for (let i = 0; i < stationNodes.length; i++) {
            let node = stationNodes[i];
            if (node.level === 0) {
                finalSelection.push(node);
                lastSelectedTime = node.time;
                continue;
            }

            let tooCloseToLevel0 = level0Nodes.some(l0 => Math.abs(l0.time - node.time) < 10);
            if (tooCloseToLevel0) continue;

            if (node.time - lastSelectedTime >= 10) {
                let windowEnd = Math.max(node.time, lastSelectedTime + 15);
                let candidates = [];
                for (let j = i; j < stationNodes.length; j++) {
                    let cand = stationNodes[j];
                    if (cand.time > windowEnd) break;
                    let candTooClose = level0Nodes.some(l0 => Math.abs(l0.time - cand.time) < 10);
                    if (!candTooClose) {
                        candidates.push(cand);
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => a.level - b.level || a.time - b.time);
                    let best = candidates[0];
                    finalSelection.push(best);
                    lastSelectedTime = best.time;
                    i = stationNodes.indexOf(best);
                }
            }
        }

        let displayTicks = finalSelection.map(n => n.time);

        let avgDelay = totalCount > 0 ? (totalDelay / totalCount).toFixed(1) : 0;
        titleHTML += ` <span style="color: #ff9900; font-size: 0.85em; font-weight: normal; margin-left: 10px;">平均誤點: ${avgDelay} 分</span>`;

        let maxTime = Math.max(...xTicks);
        let targetWidthPercent = Math.max(100, (maxTime / 480) * 100);

        let isMobile = window.innerWidth <= 600;
        let yMax = isMobile ? Math.ceil(Math.max(10, localMaxDelay * 1.1) / 5) * 5 : window.yAxisMax;
        
        let mobileHeight = isMobile ? Math.floor(140 + (localMaxDelay / (window.yAxisMax || 1)) * 60) : 400;

        const containerHTML = `
            <div class="chart-container" id="chart-train-${train.No}" style="overflow: hidden; --mobile-height: ${mobileHeight}px;">
                <h2 class="chart-title">${titleHTML}</h2>
                <div style="display: flex; height: calc(100% - ${isMobile ? 20 : 40}px); width: 100%;">
                    <div style="width: 60px; flex-shrink: 0; background-color: rgba(13, 21, 38, 0.95); border-right: 1px solid rgba(208, 255, 230, 0.1); z-index: 10;">
                        <canvas class="y-axis-canvas"></canvas>
                    </div>
                    <div class="history-chart-scroll-container custom-scrollbar" style="flex-grow: 1; overflow-x: auto; overflow-y: hidden;">
                        <div style="position: relative; height: 100%; min-width: ${targetWidthPercent}%;">
                            <canvas class="main-chart-canvas"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;
        wrapper.insertAdjacentHTML('beforeend', containerHTML);
        const container = wrapper.lastElementChild;
        const yCanvas = container.querySelector('.y-axis-canvas');
        const canvas = container.querySelector('.main-chart-canvas');

        // Overview Chart: Average of all days for this train
        const avgChartData = [];
        Object.values(stationDelays).forEach(sd => {
            avgChartData.push({ x: sd.totalTime / sd.count, y: Math.round(sd.totalDelay / sd.count), stationName: sd.stationName });
        });
        avgChartData.sort((a, b) => a.x - b.x);

        overviewDatasets.push({
            label: getTrainTypeName(tType, train.No),
            data: avgChartData,
            borderColor: neonColor,
            backgroundColor: 'transparent',
            borderWidth: 1,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 5,
            clip: false
        });

        container._renderChart = () => {
            new Chart(yCanvas, {
                type: 'line',
                data: { datasets: [] },
                options: {
                    layout: { padding: { top: isMobile ? 5 : 10, bottom: isMobile ? 5 : 15, left: 5, right: 5 } },
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: false } },
                    scales: {
                        x: {
                            min: 0, max: 1, grid: { display: false }, border: { display: false },
                            ticks: { color: 'transparent', maxRotation: 45, minRotation: 45, callback: () => ' ' },
                            title: { display: !isMobile, text: ' ', font: { size: 14 } }
                        },
                        y: {
                            min: 0, max: yMax,
                            title: { display: false },
                            grid: { display: false }, border: { display: false },
                            ticks: { color: '#94a3b8', stepSize: 5, precision: 0 }
                        }
                    }
                }
            });

            new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: allDatasets
                },
                options: {
                    layout: {
                        padding: { top: isMobile ? 5 : 10, bottom: isMobile ? 5 : 15, left: 0, right: 20 }
                    },
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            min: 0,
                            max: Math.max(480, maxTime),
                            title: { display: !isMobile, text: '停靠站', color: '#d0ffe6', font: { size: 14, family: "'Courier New', Courier, monospace" } },
                            grid: { color: 'rgba(208, 255, 230, 0.1)' },
                            afterBuildTicks: axis => { axis.ticks = displayTicks.map(v => ({ value: v })); },
                            ticks: {
                                color: '#94a3b8', maxRotation: 45, minRotation: 45,
                                callback: function (value) { return timeToStation[value] || value; }
                            }
                        },
                        y: {
                            min: 0, max: yMax,
                            title: { display: false },
                            grid: { color: 'rgba(208, 255, 230, 0.1)' },
                            ticks: { display: false, stepSize: 5 },
                            border: { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(13, 21, 38, 0.9)', titleColor: '#00f0ff', bodyColor: '#e2e8f0', borderColor: '#1e293b', borderWidth: 1, displayColors: false,
                            callbacks: {
                                title: function (context) {
                                    return context[0].raw.stationName || timeToStation[context[0].raw.x] || '';
                                },
                                label: function (context) {
                                    return `${context.raw.dateLabel} 誤點: ${context.raw.y} 分鐘`;
                                }
                            }
                        }
                    }
                }
            });
        };
        observer.observe(container);
    });

    document.getElementById('overview-chart-container').style.display = 'block';
    const overviewCanvas = document.getElementById('overview-canvas');
    if (window.overviewChart) {
        window.overviewChart.destroy();
    }
    window.overviewChart = new Chart(overviewCanvas, {
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
                    max: window.yAxisMax,
                    title: { display: true, text: '誤點時間 (分)', color: '#d0ffe6' },
                    grid: { color: 'rgba(208, 255, 230, 0.1)' },
                    ticks: { color: '#94a3b8', stepSize: 5, precision: 0 }
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
}

function renderStationCharts() {
    const wrapper = document.getElementById('charts-wrapper');
    const stationDataMap = {};

    window.processedTrains.forEach(train => {
        const trainData = window.trainTypeMap[train.No];
        const tType = trainData?.train || "";

        train.daysData.forEach(day => {
            day.data.forEach(d => {
                const sid = d.StationID;
                if (!stationDataMap[sid]) {
                    stationDataMap[sid] = [];
                }

                let timeParts = (d.Update || "").split(":");
                if (timeParts.length !== 3) return;
                let minutes = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);

                if (minutes < 5 * 60) {
                    minutes += 24 * 60;
                }

                stationDataMap[sid].push({
                    x: minutes,
                    y: d.Delay,
                    trainNo: train.No,
                    trainType: tType,
                    dateLabel: day.dateLabel
                });
            });
        });
    });

    const stationIds = Object.keys(stationDataMap).sort();

    const avgDelayData = [];
    stationIds.forEach(sid => {
        const points = stationDataMap[sid];
        let totalDelay = 0;
        points.forEach(p => totalDelay += p.y);
        let avg = points.length > 0 ? (totalDelay / points.length) : 0;
        avgDelayData.push({
            sid: sid,
            sName: stationsMap[sid] || sid,
            avg: parseFloat(avg.toFixed(1))
        });
    });

    avgDelayData.sort((a, b) => b.avg - a.avg);

    const minWidth = avgDelayData.length * 30;
    const maxBarDelay = avgDelayData.length > 0 ? Math.ceil(Math.max(10, avgDelayData[0].avg * 1.2) / 5) * 5 : 10;

    const barContainerHTML = `
        <div class="chart-container" id="avg-delay-bar-chart">
            <h2 class="chart-title">各車站平均誤點時間排名</h2>
            <div style="display: flex; height: calc(100% - 40px); width: 100%;">
                <div style="width: 60px; flex-shrink: 0; background-color: rgba(13, 21, 38, 0.95); border-right: 1px solid rgba(208, 255, 230, 0.1); z-index: 10;">
                    <canvas class="y-axis-canvas"></canvas>
                </div>
                <div class="history-chart-scroll-container custom-scrollbar" style="flex-grow: 1; overflow-x: auto; overflow-y: hidden;">
                    <div style="position: relative; height: 100%; min-width: max(100%, ${minWidth}px);">
                        <canvas class="main-chart-canvas"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;
    wrapper.insertAdjacentHTML('beforeend', barContainerHTML);
    const barContainer = wrapper.lastElementChild;
    const barYCanvas = barContainer.querySelector('.y-axis-canvas');
    const barCanvas = barContainer.querySelector('.main-chart-canvas');

    new Chart(barYCanvas, {
        type: 'line',
        data: { datasets: [] },
        options: {
            layout: { padding: { top: 10, bottom: 15, left: 5, right: 5 } },
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: {
                    min: 0, max: 1, grid: { display: false }, border: { display: false },
                    ticks: { color: 'transparent', maxRotation: 45, minRotation: 45, callback: () => ' ' },
                    title: { display: true, text: ' ', font: { size: 14 } }
                },
                y: {
                    min: 0, max: maxBarDelay,
                    title: { display: false },
                    grid: { display: false }, border: { display: false },
                    ticks: { color: '#94a3b8', stepSize: 5, precision: 0 }
                }
            }
        }
    });

    new Chart(barCanvas, {
        type: 'bar',
        data: {
            labels: avgDelayData.map(d => d.sName),
            datasets: [{
                label: '平均誤點 (分)',
                data: avgDelayData.map(d => d.avg),
                backgroundColor: avgDelayData.map(d => {
                    if (d.avg === 0) return '#00ffaa';
                    if (d.avg <= 5) return '#ff9900';
                    if (d.avg <= 20) return '#ff0055';
                    return '#ce6be0';
                }),
                borderWidth: 0,
                borderRadius: 4
            }]
        },
        options: {
            layout: { padding: { top: 10, bottom: 15, left: 0, right: 20 } },
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45 },
                    grid: { display: false }
                },
                y: {
                    min: 0, max: maxBarDelay,
                    title: { display: false },
                    ticks: { display: false, stepSize: 5 },
                    grid: { color: 'rgba(208, 255, 230, 0.1)' },
                    border: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 21, 38, 0.9)', titleColor: '#00f0ff', bodyColor: '#e2e8f0'
                }
            }
        }
    });

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                const sid = container.getAttribute('data-sid');
                renderSingleStationChart(sid, stationDataMap[sid], container);
                obs.unobserve(container);
            }
        });
    }, { rootMargin: '200px' });

    stationIds.forEach(sid => {
        const sName = stationsMap[sid] || sid;
        const points = stationDataMap[sid];

        let totalDelay = 0;
        let localMaxDelay = 0;
        points.forEach(p => {
            totalDelay += p.y;
            if (p.y > localMaxDelay) localMaxDelay = p.y;
        });
        let avgDelay = points.length > 0 ? (totalDelay / points.length).toFixed(1) : 0;

        let isMobile = window.innerWidth <= 600;
        let yMax = isMobile ? Math.ceil(Math.max(10, localMaxDelay * 1.1) / 5) * 5 : window.yAxisMax;
        
        let mobileHeight = isMobile ? Math.floor(140 + (localMaxDelay / (window.yAxisMax || 1)) * 60) : 400;

        const containerHTML = `
            <div class="chart-container" id="chart-station-${sid}" style="overflow: hidden; --mobile-height: ${mobileHeight}px;" data-sname="${sName}" data-sid="${sid}" data-ymax="${yMax}">
                <h2 class="chart-title">
                    <span style="color: #00f0ff; text-shadow: 0 0 8px #00f0ff;">${sName}</span> 
                    <span style="color: #94a3b8; font-size: 0.8em;">(代碼: ${sid})</span> 
                    <span style="color: #ff9900; font-size: 0.85em; font-weight: normal; margin-left: 10px;">平均誤點: ${avgDelay} 分</span>
                </h2>
                <div style="display: flex; height: calc(100% - ${isMobile ? 20 : 40}px); width: 100%;">
                    <div style="width: 60px; flex-shrink: 0; background-color: rgba(13, 21, 38, 0.95); border-right: 1px solid rgba(208, 255, 230, 0.1); z-index: 10;">
                        <canvas class="y-axis-canvas"></canvas>
                    </div>
                    <div class="history-chart-scroll-container custom-scrollbar" style="flex-grow: 1; overflow-x: auto; overflow-y: hidden;">
                        <div style="position: relative; height: 100%; min-width: 200%;">
                            <canvas class="main-chart-canvas"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;
        wrapper.insertAdjacentHTML('beforeend', containerHTML);
        const container = wrapper.lastElementChild;

        observer.observe(container);
    });
}

function renderSingleStationChart(sid, points, container) {
    const yCanvas = container.querySelector('.y-axis-canvas');
    const mainCanvas = container.querySelector('.main-chart-canvas');
    if (!yCanvas || !mainCanvas) return;

    let yMax = parseFloat(container.getAttribute('data-ymax')) || window.yAxisMax;
    let isMobile = window.innerWidth <= 600;

    new Chart(yCanvas, {
        type: 'line',
        data: { datasets: [] },
        options: {
            layout: { padding: { top: isMobile ? 5 : 10, bottom: isMobile ? 5 : 15, left: 5, right: 5 } },
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: {
                    min: 0, max: 1, grid: { display: false }, border: { display: false },
                    ticks: { color: 'transparent', maxRotation: 45, minRotation: 45, callback: () => ' ' },
                    title: { display: !isMobile, text: ' ', font: { size: 14 } }
                },
                y: {
                    min: 0, max: yMax,
                    title: { display: false },
                    grid: { display: false }, border: { display: false },
                    ticks: { color: '#94a3b8', stepSize: 5, precision: 0 }
                }
            }
        }
    });

    new Chart(mainCanvas, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '誤點時間 (分鐘)',
                data: points,
                backgroundColor: function (context) {
                    if (context.raw === undefined) return '#00ffaa';
                    const tType = context.raw.trainType;
                    return colorPalette[tType] || '#64748b';
                },
                borderColor: 'transparent',
                borderWidth: 0,
                pointRadius: 2,
                pointHoverRadius: 3,
                clip: false
            }]
        },
        options: {
            layout: {
                padding: { top: isMobile ? 5 : 10, bottom: isMobile ? 5 : 15, left: 0, right: 20 }
            },
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    min: 300,
                    max: 1500,
                    title: { display: !isMobile, text: '當天時間', color: '#d0ffe6', font: { size: 14, family: "'Courier New', Courier, monospace" } },
                    grid: { color: 'rgba(208, 255, 230, 0.1)' },
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 45,
                        minRotation: 45,
                        callback: function (value) {
                            let h = Math.floor(value / 60);
                            const m = Math.floor(value % 60);
                            if (h >= 24) h -= 24;
                            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                        }
                    }
                },
                y: {
                    min: 0, max: window.yAxisMax,
                    title: { display: false },
                    grid: { color: 'rgba(208, 255, 230, 0.1)' },
                    ticks: { display: false, stepSize: 5 },
                    border: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 21, 38, 0.9)', titleColor: '#00f0ff', bodyColor: '#e2e8f0', borderColor: '#1e293b', borderWidth: 1, displayColors: false,
                    callbacks: {
                        title: function (context) {
                            const p = context[0].raw;
                            return `${p.dateLabel} ${p.trainType} ${p.trainNo}`;
                        },
                        label: function (context) {
                            const p = context.raw;
                            let h = Math.floor(p.x / 60);
                            const m = Math.floor(p.x % 60);
                            if (h >= 24) h -= 24;
                            const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                            return `誤點: ${p.y} 分鐘`;
                        }
                    }
                }
            }
        }
    });
}

document.getElementById('fetch-btn').addEventListener('click', async () => {
    await fetchData(true);
    if (document.getElementById('map-view-modal').style.display === 'flex' && isMapInitialized) {
        updateMapForTime(parseInt(document.getElementById('time-slider').value, 10));
    }
});

['start-date-input', 'end-date-input'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        if (document.getElementById('map-view-modal').style.display !== 'flex') {
            fetchData(false);
        }
    });
    document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            fetchData(true);
        }
    });
});

document.getElementById('view-mode-btn').addEventListener('click', () => {
    window.currentViewMode = window.currentViewMode === 'train' ? 'station' : 'train';
    const btn = document.getElementById('view-mode-btn');
    btn.textContent = window.currentViewMode === 'train' ? '切換至: 各車站' : '切換至: 各車次';

    document.getElementById('train-search-input').value = '';
    document.getElementById('train-suggestions').style.display = 'none';

    if (window.processedTrains && window.processedTrains.length > 0) {
        renderCharts();
    }
});

const searchInput = document.getElementById('train-search-input');
const suggestionsBox = document.getElementById('train-suggestions');
let currentFocus = -1;

searchInput.addEventListener('input', () => {
    currentFocus = -1;
    const query = searchInput.value.trim();
    suggestionsBox.style.display = 'none';

    if (!query || !window.processedTrains) return;

    const suggestions = [];

    const activeStations = new Set();
    window.processedTrains.forEach(t => {
        t.data.forEach(d => activeStations.add(d.StationID));
    });

    const uniqueStations = [];
    activeStations.forEach(sid => {
        const sName = stationsMap[sid] || sid;
        if (sName.includes(query) || sid.includes(query)) {
            uniqueStations.push({ id: sid, name: sName });
        }
    });

    uniqueStations.forEach(s => {
        suggestions.push(`<div class="suggestion-item" data-id="${s.id}" data-type="station"><span style="color: #00f0ff;">${s.name}</span> <span style="color: #94a3b8; font-size: 0.9em;">(${s.id})</span></div>`);
    });

    const trainMatches = window.processedTrains.filter(t => {
        const noMatch = String(t.No).includes(query);
        const trainData = window.trainTypeMap[t.No];
        const tType = trainData?.train || "";
        const typeMatch = tType.includes(query) || getTrainTypeName(tType, t.No).includes(query);
        return noMatch || typeMatch;
    });
    trainMatches.forEach(t => {
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
        suggestions.push(`<div class="suggestion-item" data-id="${t.No}" data-type="train">${displayName}</div>`);
    });

    if (suggestions.length > 0) {
        suggestionsBox.innerHTML = suggestions.join('');
        suggestionsBox.style.display = 'block';
        suggestionsBox.scrollTop = 0;
    }

    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-id');
            const targetType = item.getAttribute('data-type');

            if (window.currentViewMode !== targetType) {
                document.getElementById('view-mode-btn').click();
            }

            searchInput.value = item.textContent.replace(/ \(車次\)| \(車站\)/g, '').replace(/ \(.+\)$/, '').trim();
            suggestionsBox.style.display = 'none';

            setTimeout(() => {
                jumpToTarget(targetId);
            }, 100);
        });
    });
});

document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== suggestionsBox) {
        suggestionsBox.style.display = 'none';
    }
});

function jumpToTarget(targetId) {
    closeMobileSearchForm();
    if (!targetId) return;
    const prefix = window.currentViewMode === 'train' ? 'chart-train-' : 'chart-station-';
    const target = document.getElementById(`${prefix}${targetId}`);
    if (target) {
        const appContainer = document.getElementById('history-app-container');
        if (appContainer) {
            const offset = target.offsetTop - (appContainer.clientHeight / 2) + (target.clientHeight / 2);
            appContainer.scrollTo({ top: offset, behavior: 'smooth' });
        } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        target.style.transition = 'box-shadow 0.3s ease';
        target.style.boxShadow = '0 0 20px #00f0ff';
        setTimeout(() => {
            target.style.boxShadow = 'none';
        }, 2000);
        document.getElementById('train-search-input').value = '';
    } else {
        alert(window.currentViewMode === 'train' ? "找不到指定的車次圖表" : "找不到指定的車站圖表");
    }
}

document.getElementById('search-btn').addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (!query) return;

    let targetId = query;
    let targetType = window.currentViewMode;

    const exactTrain = window.processedTrains?.find(t => String(t.No) === query);
    if (exactTrain) {
        targetId = exactTrain.No;
        targetType = 'train';
    } else {
        const firstMatch = suggestionsBox.querySelector('.suggestion-item');
        if (firstMatch) {
            targetId = firstMatch.getAttribute('data-id');
            targetType = firstMatch.getAttribute('data-type');
        }
    }

    if (window.currentViewMode !== targetType) {
        document.getElementById('view-mode-btn').click();
    }

    suggestionsBox.style.display = 'none';
    setTimeout(() => {
        jumpToTarget(targetId);
    }, 100);
});

searchInput.addEventListener('keydown', (e) => {
    const items = suggestionsBox.getElementsByClassName('suggestion-item');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentFocus++;
        addActive(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentFocus--;
        addActive(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (suggestionsBox.style.display === 'block' && currentFocus > -1 && items.length > 0) {
            items[currentFocus].click();
        } else {
            const query = searchInput.value.trim();
            if (!query) return;

            let targetId = query;
            let targetType = window.currentViewMode;

            const exactTrain = window.processedTrains?.find(t => String(t.No) === query);
            if (exactTrain) {
                targetId = exactTrain.No;
                targetType = 'train';
            } else {
                const firstMatch = suggestionsBox.querySelector('.suggestion-item');
                if (firstMatch) {
                    targetId = firstMatch.getAttribute('data-id');
                    targetType = firstMatch.getAttribute('data-type');
                }
            }

            if (window.currentViewMode !== targetType) {
                document.getElementById('view-mode-btn').click();
            }

            suggestionsBox.style.display = 'none';
            setTimeout(() => {
                jumpToTarget(targetId);
            }, 100);
        }
    }
});

function addActive(items) {
    if (!items || items.length === 0) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    items[currentFocus].classList.add('suggestion-active');
    items[currentFocus].scrollIntoView({ block: 'nearest' });
}

function removeActive(items) {
    for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('suggestion-active');
    }
}

// Initialize
init();

// --- Map View Logic ---
let mapSvg, mapMainGroup, mapProjection;
let isMapInitialized = false;
let globalStationsHub = null;
let playInterval = null;
let playbackSpeed = 1;
let isLoopPlayback = false;

document.getElementById('delay-map-btn').addEventListener('click', () => {
    // Hide standard elements
    document.getElementById('view-mode-btn').style.display = 'none';
    document.getElementById('delay-map-btn').style.display = 'none';
    document.getElementById('search-label').parentElement.style.display = 'none';
    
    // Show close map button
    document.getElementById('close-map-btn').style.display = 'block';

    // Toggle chart vs map view
    document.getElementById('charts-main-content').style.display = 'none';
    document.getElementById('map-view-modal').style.display = 'flex';
    
    if (!isMapInitialized) {
        initHistoryMap();
    }
    updateMapForTime(parseInt(document.getElementById('time-slider').value, 10));
});

document.getElementById('close-map-btn').addEventListener('click', () => {
    pauseAutoPlay();
    
    // Restore standard elements
    document.getElementById('view-mode-btn').style.display = 'block';
    document.getElementById('delay-map-btn').style.display = 'block';
    document.getElementById('search-label').parentElement.style.display = 'flex';
    
    // Hide close map button
    document.getElementById('close-map-btn').style.display = 'none';

    // Toggle chart vs map view
    document.getElementById('map-view-modal').style.display = 'none';
    document.getElementById('charts-main-content').style.display = 'block';
});

['start-date-input', 'end-date-input'].forEach(id => {
    document.getElementById(id).addEventListener('change', async () => {
        // If map is open, fetch new data silently and update map
        if (document.getElementById('map-view-modal').style.display === 'flex') {
            await fetchData(false);
            if (isMapInitialized) {
                updateMapForTime(parseInt(document.getElementById('time-slider').value, 10));
            }
        }
    });
});

function initHistoryMap() {
    isMapInitialized = true;
    const width = 800;
    const height = 800;

    mapSvg = d3.select("#history-map-svg")
        .attr("viewBox", `0 0 ${width} ${height}`);
    
    mapMainGroup = mapSvg.append("g");

    mapProjection = d3.geoMercator()
        .center([121, 23.6])
        .scale(9000)
        .translate([width / 2, height / 2]);

    const path = d3.geoPath().projection(mapProjection);

    const zoom = d3.zoom()
        .scaleExtent([0.1, 40])
        .on("zoom", (event) => {
            mapMainGroup.attr("transform", event.transform);
            const k = event.transform.k;
            mapMainGroup.selectAll(".station")
                .attr("r", d => {
                    let base = d.level !== undefined ? (4.5 - d.level * 0.5) : 3;
                    return Math.max(0.6, base / Math.sqrt(k));
                })
                .style("stroke-width", `${0.3 / k}px`);
        });

    mapSvg.call(zoom);

    if (window.countiesData && window.countiesData.objects) {
        let objectsKey = Object.keys(window.countiesData.objects)[0];
        if (window.countiesData.objects["counties"]) objectsKey = "counties";
        else if (window.countiesData.objects["towns"]) objectsKey = "towns";
        
        const counties = topojson.feature(window.countiesData, window.countiesData.objects[objectsKey]).features;
        mapMainGroup.selectAll(".county")
            .data(counties)
            .enter()
            .append("path")
            .attr("class", "county")
            .attr("d", path);
    }

    if (window.globalStationsData) {
        const stationGroups = mapMainGroup.selectAll(".station-group")
            .data(window.globalStationsData)
            .enter()
            .append("g")
            .attr("class", "station-group")
            .attr("transform", d => {
                let lat, lon;
                if (d.gps) {
                    const parts = d.gps.toString().trim().split(/[\s,]+/);
                    const nums = parts.map(Number).filter(n => !isNaN(n));
                    lat = nums.find(n => n > 21 && n < 26);
                    lon = nums.find(n => n > 119 && n < 123);
                } else if (d['緯度'] && d['經度']) {
                    lat = parseFloat(d['緯度']);
                    lon = parseFloat(d['經度']);
                }
                if (!lat || !lon) return "translate(-9999, -9999)";
                const pos = mapProjection([lon, lat]);
                return `translate(${pos[0]}, ${pos[1]})`;
            });

        stationGroups.append("circle")
            .attr("class", "station")
            .attr("r", d => d.level !== undefined ? (4.5 - d.level * 0.5) : 3)
            .attr("cx", 0)
            .attr("cy", 0)
            .on("mouseover", function (event, d) {
                const tooltip = d3.select("#history-tooltip");
                const name = getStationNameStr(d);
                tooltip.style("opacity", 1)
                    .html(name)
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 10) + "px");
            })
            .on("mouseleave", function (event, d) {
                d3.select("#history-tooltip").style("opacity", 0);
            });
        
        buildStationsHub();
    }
}

function buildStationsHub() {
    globalStationsHub = {};
    const stationsData = window.globalStationsData;
    if (!stationsData) return;

    function getStationName(d) {
        return d.stationName || d['車站中文名稱'] || d.name || "";
    }

    function addEdge(idx1, idx2) {
        if (!stationsData[idx1] || !stationsData[idx2]) return;
        let n1 = getStationName(stationsData[idx1]);
        let n2 = getStationName(stationsData[idx2]);
        if (!globalStationsHub[n1]) globalStationsHub[n1] = new Set();
        if (!globalStationsHub[n2]) globalStationsHub[n2] = new Set();
        globalStationsHub[n1].add(n2);
        globalStationsHub[n2].add(n1);
    }

    function makeArr(start, end) {
        let arr = [];
        if (start <= end) { for (let i = start; i <= end; i++) arr.push(i); }
        else { for (let i = start; i >= end; i--) arr.push(i); }
        return arr;
    }

    let leftCoast = [...makeArr(14, 30), ...makeArr(43, 47), ...makeArr(64, 84), ...makeArr(85, 92), ...makeArr(99, 124), ...makeArr(127, 158)];
    let rightCoast = [...makeArr(168, 194), ...makeArr(195, 205), 207, ...makeArr(208, 226), ...makeArr(233, 234), ...makeArr(237, 238), 2];

    function mapChain(stations) {
        for (let i = 0; i < stations.length - 1; i++) {
            addEdge(stations[i], stations[i + 1]);
        }
    }
    
    mapChain(makeArr(2, 14));
    mapChain(leftCoast);
    mapChain(makeArr(158, 168));
    mapChain(rightCoast);

    let seaStations = makeArr(48, 63);
    addEdge(47, seaStations[0]);
    addEdge(seaStations[seaStations.length - 1], 85);
    mapChain(seaStations);

    function drawBranch(stationsArr, junctionIdx) {
        addEdge(junctionIdx, stationsArr[0]);
        mapChain(stationsArr);
    }
    
    drawBranch([1, 0], 2);
    drawBranch([206], 207);
    drawBranch([31, 32, 33, 35, 36, 37, 38, 39, 40, 41, 42], 30);
    drawBranch([34], 33);
    drawBranch(makeArr(93, 98), 92);
    drawBranch([125, 126], 124);
    drawBranch(makeArr(227, 232), 226);
    drawBranch([235, 236], 234);
}

function getTopoPath(startLoc, endLoc) {
    if (!globalStationsHub) return null;
    if (startLoc === endLoc) return [startLoc];

    const queue = [{ loc: startLoc, path: [startLoc] }];
    const visited = new Set([startLoc]);

    while (queue.length > 0) {
        const { loc, path } = queue.shift();
        if (loc === endLoc) return path;
        if (path.length > 5) continue; // max distance 4 means max path length 5

        const neighbors = globalStationsHub[loc];
        if (neighbors) {
            for (const n of neighbors) {
                if (!visited.has(n)) {
                    visited.add(n);
                    queue.push({ loc: n, path: [...path, n] });
                }
            }
        }
    }
    return null;
}

function getStationNameStr(d) {
    return d.stationName || d['車站中文名稱'] || d.name || "";
}

function updateMapForTime(sliderMinutes) {
    let dayIndex = Math.floor((sliderMinutes - 300) / 1440);
    let localMinutes = ((sliderMinutes - 300) % 1440) + 300;
    
    if (window.activeDateObjects && window.activeDateObjects.length > 0) {
        if (dayIndex >= window.activeDateObjects.length) {
            dayIndex = window.activeDateObjects.length - 1;
            localMinutes = 1440 + 300;
        }
        document.getElementById('date-display').innerText = window.activeDateObjects[dayIndex].label;
    }

    const timeDisplay = document.getElementById('time-display');
    const h = Math.floor(localMinutes / 60);
    const m = localMinutes % 60;
    timeDisplay.innerText = `${String(h >= 24 ? h - 24 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    if (!window.processedTrains || !isMapInitialized) return;

    const delayedTrainLocs = [];
    const sliderSeconds = localMinutes * 60;

    window.processedTrains.forEach(train => {
        if (!window.activeDateObjects || !window.activeDateObjects[dayIndex]) return;
        const dayDataObj = train.daysData.find(d => d.dateLabel === window.activeDateObjects[dayIndex].label);
        if (!dayDataObj) return;

        let lastRecord = null;
        for (let i = 0; i < dayDataObj.data.length; i++) {
            if (dayDataObj.data[i]._absTime <= sliderSeconds) {
                lastRecord = dayDataObj.data[i];
            } else {
                break;
            }
        }

        if (lastRecord) {
            if (lastRecord.Delay > 3) {
                const isFinishedAndOld = (sliderSeconds - lastRecord._absTime > 30 * 60) && (lastRecord === dayDataObj.data[dayDataObj.data.length - 1]);
                if (!isFinishedAndOld) {
                    const sid = lastRecord.StationID;
                    const sName = stationsMap[sid] || sid;
                    delayedTrainLocs.push({ loc: sName });
                }
            }
        }
    });

    const nodes = [...delayedTrainLocs];
    const parent = new Map();
    nodes.forEach(n => parent.set(n.loc, n.loc));

    function find(i) {
        if (parent.get(i) === i) return i;
        parent.set(i, find(parent.get(i)));
        return parent.get(i);
    }
    function union(i, j) {
        parent.set(find(i), find(j));
    }

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            if (getTopoPath(nodes[i].loc, nodes[j].loc)) {
                union(nodes[i].loc, nodes[j].loc);
            }
        }
    }

    const grouped = new Map();
    for (const node of nodes) {
        const root = find(node.loc);
        if (!grouped.has(root)) grouped.set(root, []);
        grouped.get(root).push(node);
    }

    const delayedSectionStationNames = new Set();
    for (const cluster of grouped.values()) {
        if (cluster.length >= 3) {
            for (let i = 0; i < cluster.length; i++) {
                for (let j = i + 1; j < cluster.length; j++) {
                    const path = getTopoPath(cluster[i].loc, cluster[j].loc);
                    if (path) {
                        path.forEach(p => delayedSectionStationNames.add(p));
                    }
                }
            }
        }
    }

    d3.selectAll("#history-map-svg .station").classed("delay-highlight", d => {
        return delayedSectionStationNames.has(getStationNameStr(d));
    });
}

document.getElementById('time-slider').addEventListener('input', (e) => {
    updateMapForTime(parseInt(e.target.value, 10));
});

const playPauseBtn = document.getElementById('play-pause-btn');
const loopBtn = document.getElementById('loop-btn');
const speedBtn = document.getElementById('speed-btn');

loopBtn.addEventListener('click', () => {
    isLoopPlayback = !isLoopPlayback;
    loopBtn.style.opacity = isLoopPlayback ? "1" : "0.5";
});

speedBtn.addEventListener('click', () => {
    if (playbackSpeed === 1) playbackSpeed = 2;
    else if (playbackSpeed === 2) playbackSpeed = 0.5;
    else playbackSpeed = 1;
    speedBtn.innerText = playbackSpeed + 'X';
    if (playInterval) {
        pauseAutoPlay();
        toggleAutoPlay();
    }
});

function toggleAutoPlay() {
    if (playInterval) {
        pauseAutoPlay();
    } else {
        const slider = document.getElementById('time-slider');
        if (parseInt(slider.value, 10) >= parseInt(slider.max, 10)) {
            slider.value = slider.min;
            updateMapForTime(parseInt(slider.value, 10));
        }
        
        playPauseBtn.innerText = '⏸️';
        playInterval = setInterval(() => {
            const slider = document.getElementById('time-slider');
            let val = parseInt(slider.value, 10);
            val += 5;
            if (val > parseInt(slider.max, 10)) {
                if (isLoopPlayback) {
                    val = parseInt(slider.min, 10);
                } else {
                    pauseAutoPlay();
                    return;
                }
            }
            slider.value = val;
            updateMapForTime(val);
        }, (1000 / 12) / playbackSpeed);
    }
}

function pauseAutoPlay() {
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
    playPauseBtn.innerText = '▶️';
}
playPauseBtn.addEventListener('click', toggleAutoPlay);

document.getElementById('reset-time-btn').addEventListener('click', () => {
    pauseAutoPlay();
    const slider = document.getElementById('time-slider');
    slider.value = slider.min;
    updateMapForTime(parseInt(slider.min, 10));
});
