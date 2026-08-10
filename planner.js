let stations = [];
let stationCodeToName = {};
let stationNameToCode = {};
let scheduleData = [];
let liveBoardData = {};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 初始化日期時間 (預設為現在)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    
    document.getElementById('travel-date').value = `${yyyy}-${mm}-${dd}`;
    document.getElementById('travel-time').value = `${hh}:${min}`;

    // 2. 載入車站資料
    await loadStations();

    // 3. 綁定事件
    document.getElementById('search-plan-btn').addEventListener('click', handleSearch);
    document.getElementById('swap-stations-btn').addEventListener('click', swapStations);
    
    setupAutocomplete('from-station', 'from-suggestions');
    setupAutocomplete('to-station', 'to-suggestions');
});

async function loadStations() {
    try {
        const res = await fetch('stations.json');
        stations = await res.json();
        stations.forEach(s => {
            stationCodeToName[s.stationCode] = s.stationName;
            stationNameToCode[s.stationName] = s.stationCode;
        });
    } catch (e) {
        console.error("無法載入車站資料", e);
    }
}

function setupAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener('input', () => {
        const val = input.value.trim();
        dropdown.innerHTML = '';
        if (!val) {
            dropdown.classList.remove('active');
            return;
        }

        const matches = stations.filter(s => s.stationName.includes(val) || s.stationCode.includes(val));
        if (matches.length > 0) {
            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = 'suggestion-item-planner';
                div.textContent = `${match.stationName} (${match.stationCode})`;
                div.addEventListener('click', () => {
                    input.value = match.stationName;
                    dropdown.classList.remove('active');
                });
                dropdown.appendChild(div);
            });
            dropdown.classList.add('active');
        } else {
            dropdown.classList.remove('active');
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== dropdown) {
            dropdown.classList.remove('active');
        }
    });
}

function swapStations() {
    const from = document.getElementById('from-station');
    const to = document.getElementById('to-station');
    const temp = from.value;
    from.value = to.value;
    to.value = temp;
}

// 產生最近的即時動態網址
function getLatestTDXUrl(targetDate) {
    // 若查詢的日期不是今天，不抓即時動態 (只用時刻表)
    const now = new Date();
    if (targetDate.toDateString() !== now.toDateString()) {
        return null; 
    }
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const roundedMinutes = Math.floor(now.getMinutes() / 5) * 5;
    const minutes = String(roundedMinutes).padStart(2, '0');
    const datetimeStr = `${month}${date}${hours}${minutes}`;
    return `https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/data/data_${datetimeStr}.json?t=${now.getTime()}`;
}

function getScheduleUrl(dateStr) {
    const fullDateStr = dateStr.replace(/-/g, '');
    return `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${fullDateStr}.json`;
}

// 時間字串轉換成分鐘 (例如 "08:30" => 510)
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// 分鐘轉換為時間字串 (例如 510 => "08:30")
function minutesToTime(mins) {
    let h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    if (h >= 24) h -= 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function handleSearch() {
    const fromStr = document.getElementById('from-station').value.trim();
    const toStr = document.getElementById('to-station').value.trim();
    const dateStr = document.getElementById('travel-date').value;
    const timeStr = document.getElementById('travel-time').value;
    const directOnly = document.getElementById('direct-only').checked;

    const fromCode = stationNameToCode[fromStr] || fromStr;
    const toCode = stationNameToCode[toStr] || toStr;

    if (!fromCode || !toCode || !stationCodeToName[fromCode] || !stationCodeToName[toCode]) {
        alert("請輸入正確的車站名稱或代碼");
        return;
    }

    if (fromCode === toCode) {
        alert("出發站與抵達站不能相同");
        return;
    }

    const container = document.getElementById('results-container');
    container.innerHTML = '<div class="loading-text">正在查詢路線與即時動態...</div>';

    try {
        const targetDate = new Date(dateStr);
        const scheduleUrl = getScheduleUrl(dateStr);
        const liveUrl = getLatestTDXUrl(targetDate);

        // Fetch Schedule
        const schedRes = await fetch(scheduleUrl);
        if (!schedRes.ok) throw new Error("無法取得該日期的時刻表");
        scheduleData = await schedRes.json();

        // Fetch Live Board if applicable
        liveBoardData = {};
        if (liveUrl) {
            // 嘗試抓取即時動態，若失敗則遞減5分鐘重試 (最多試3次)
            let liveRes = await fetch(liveUrl);
            let offset = 5;
            while (!liveRes.ok && offset <= 15) {
                const retryDate = new Date(new Date().getTime() - offset * 60000);
                const retryMonth = String(retryDate.getMonth() + 1).padStart(2, '0');
                const retryDay = String(retryDate.getDate()).padStart(2, '0');
                const retryHour = String(retryDate.getHours()).padStart(2, '0');
                const retryMin = String(Math.floor(retryDate.getMinutes() / 5) * 5).padStart(2, '0');
                const retryUrl = `https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/data/data_${retryMonth}${retryDay}${retryHour}${retryMin}.json?t=${new Date().getTime()}`;
                liveRes = await fetch(retryUrl);
                offset += 5;
            }
            
            if (liveRes.ok) {
                const liveData = await liveRes.json();
                // liveData structure typically array of trains with Delay
                if (Array.isArray(liveData)) {
                    liveData.forEach(t => {
                        liveBoardData[t.TrainNo || t.No] = parseInt(t.Delay || 0, 10);
                    });
                }
            }
        }

        const userStartMins = timeToMinutes(timeStr);
        
        // 尋找路徑
        let routes = [];
        
        // 1. 尋找直達車
        const directRoutes = findDirectRoutes(fromStr, toStr, userStartMins);
        routes.push(...directRoutes);

        // 2. 尋找一次轉乘 (如果 directOnly 為 false)
        if (!directOnly) {
            const transferRoutes = findOneTransferRoutes(fromStr, toStr, userStartMins);
            routes.push(...transferRoutes);
        }

        // 過濾並排序 (以預估抵達時間排序)
        routes.sort((a, b) => {
            const arrA = timeToMinutes(a.arrivalTime) + a.arrivalDelay;
            const arrB = timeToMinutes(b.arrivalTime) + b.arrivalDelay;
            if (arrA !== arrB) return arrA - arrB;
            // 抵達時間相同，選總時間短的
            const durA = (arrA - timeToMinutes(a.departureTime) - a.departureDelay);
            const durB = (arrB - timeToMinutes(b.departureTime) - b.departureDelay);
            return durA - durB;
        });

        // 取前 20 筆
        routes = routes.slice(0, 20);

        renderRoutes(routes, container);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="color: #ff4444; text-align: center; padding: 20px;">錯誤: ${e.message}</div>`;
    }
}

function normalizeStationName(name) {
    if (!name) return "";
    return name.replace(/臺/g, '台');
}

function findDirectRoutes(fromName, toName, minDepartureMins) {
    const routes = [];
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
    scheduleData.forEach(train => {
        let fromDepIdx = -1;
        let toArrIdx = -1;
        
        const stops = train.data || [];
        for (let i = 0; i < stops.length; i++) {
            const stopName = normalizeStationName(stops[i].x);
            if (stopName === normFromName) {
                fromDepIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFromName) ? i + 1 : i;
            }
            if (stopName === normToName) {
                if (toArrIdx === -1) toArrIdx = i;
            }
        }

        // 確保方向正確且從起點出發時間符合條件
        if (fromDepIdx !== -1 && toArrIdx !== -1 && fromDepIdx < toArrIdx) {
            const depMins = stops[fromDepIdx].y;
            
            // 跨日處理 (簡易版: 假設 00:00 - 04:00 屬於隔天凌晨)
            let adjustedDepMins = depMins;
            if (depMins < 4 * 60 && minDepartureMins > 20 * 60) {
                adjustedDepMins += 24 * 60;
            }

            if (adjustedDepMins >= minDepartureMins) {
                const delay = liveBoardData[train.number] || 0;
                routes.push({
                    type: 'direct',
                    train1: train,
                    fromStation: stationNameToCode[fromName] || fromName,
                    toStation: stationNameToCode[toName] || toName,
                    departureTime: minutesToTime(depMins),
                    arrivalTime: minutesToTime(stops[toArrIdx].y),
                    departureDelay: delay,
                    arrivalDelay: delay,
                    transferStation: null
                });
            }
        }
    });
    return routes;
}

function findOneTransferRoutes(fromName, toName, minDepartureMins) {
    const routes = [];
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
    // 預先過濾出經過起點和經過終點的班次
    const fromTrains = [];
    const toTrains = [];

    scheduleData.forEach(train => {
        const stops = train.data || [];
        let hasFrom = false, hasTo = false;
        let fromDepIdx = -1, toArrIdx = -1;
        
        for (let i = 0; i < stops.length; i++) {
            const stopName = normalizeStationName(stops[i].x);
            if (stopName === normFromName) { 
                hasFrom = true; 
                fromDepIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFromName) ? i + 1 : i; 
            }
            if (stopName === normToName) { 
                hasTo = true; 
                if (toArrIdx === -1) toArrIdx = i; 
            }
        }
        
        if (hasFrom) {
            const depMins = stops[fromDepIdx].y;
            let adjustedDepMins = depMins;
            if (depMins < 4 * 60 && minDepartureMins > 20 * 60) adjustedDepMins += 24 * 60;
            
            if (adjustedDepMins >= minDepartureMins) {
                fromTrains.push({ train, fromDepIdx });
            }
        }
        
        if (hasTo) {
            toTrains.push({ train, toArrIdx });
        }
    });

    // 尋找共同停靠站
    const transferThresholdMin = 5; // 最少轉乘時間
    const transferThresholdMax = 90; // 最長轉乘時間不超過 90 分鐘

    fromTrains.forEach(t1 => {
        const train1 = t1.train;
        const delay1 = liveBoardData[train1.number] || 0;
        const t1Stops = train1.data;

        toTrains.forEach(t2 => {
            const train2 = t2.train;
            if (train1.number === train2.number) return; // 避免同一台車
            const delay2 = liveBoardData[train2.number] || 0;
            const t2Stops = train2.data;

            // 尋找轉乘站 (只看 train1 從 fromDepIdx 之後的停靠站，以及 train2 到 toArrIdx 之前的停靠站)
            for (let i = t1.fromDepIdx + 1; i < t1Stops.length; i++) {
                const t1ArrStation = t1Stops[i].x;
                const normT1ArrStation = normalizeStationName(t1ArrStation);
                // 到達轉乘站的時間 (取該站的第一筆)
                if (i > 0 && normalizeStationName(t1Stops[i-1].x) === normT1ArrStation) continue; // Skip departure entry of the transfer station for t1
                
                for (let j = 0; j < t2.toArrIdx; j++) {
                    if (normalizeStationName(t2Stops[j].x) === normT1ArrStation) {
                        // 找到共同停靠站
                        const t2DepIdx = (j + 1 < t2Stops.length && normalizeStationName(t2Stops[j+1].x) === normT1ArrStation) ? j + 1 : j;
                        
                        const arrMins = t1Stops[i].y;
                        const actualArrMins = arrMins + delay1; // 考慮誤點
                        
                        const depMins = t2Stops[t2DepIdx].y;
                        const actualDepMins = depMins + delay2; 
                        
                        let waitTime = actualDepMins - actualArrMins;
                        if (waitTime < 0 && actualDepMins < 4 * 60 && actualArrMins > 20 * 60) {
                            waitTime += 24 * 60; // 跨夜轉乘
                        }

                        if (waitTime >= transferThresholdMin && waitTime <= transferThresholdMax) {
                            routes.push({
                                type: 'transfer',
                                train1: train1,
                                train2: train2,
                                fromStation: stationNameToCode[fromName] || fromName,
                                transferStation: stationNameToCode[t1ArrStation] || t1ArrStation,
                                toStation: stationNameToCode[toName] || toName,
                                departureTime: minutesToTime(t1Stops[t1.fromDepIdx].y),
                                transferArrTime: minutesToTime(t1Stops[i].y),
                                transferDepTime: minutesToTime(t2Stops[t2DepIdx].y),
                                arrivalTime: minutesToTime(t2Stops[t2.toArrIdx].y),
                                departureDelay: delay1,
                                arrivalDelay: delay2,
                                transferWaitActual: Math.round(waitTime)
                            });
                        }
                    }
                }
            }
        });
    });

    return routes;
}

function renderRoutes(routes, container) {
    container.innerHTML = '';
    
    if (routes.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">找不到符合條件的路線</div>';
        return;
    }

    routes.forEach(route => {
        const card = document.createElement('div');
        card.className = 'result-card';
        
        let headerHtml = '';
        let timelineHtml = '';
        
        const depTime = route.departureTime;
        const arrTime = route.arrivalTime;
        const depDelay = route.departureDelay;
        const arrDelay = route.arrivalDelay;

        // 計算實際出發與抵達顯示
        let depDisplay = depTime;
        if (depDelay > 0) {
            depDisplay = `<span class="strikethrough">${depTime}</span> <span class="delay-text">+${depDelay}分 (${minutesToTime(timeToMinutes(depTime) + depDelay)})</span>`;
        }

        let arrDisplay = arrTime;
        if (arrDelay > 0) {
            arrDisplay = `<span class="strikethrough">${arrTime}</span> <span class="delay-text">+${arrDelay}分 (${minutesToTime(timeToMinutes(arrTime) + arrDelay)})</span>`;
        }
        
        // 總時長
        let startMins = timeToMinutes(depTime) + depDelay;
        let endMins = timeToMinutes(arrTime) + arrDelay;
        if (endMins < startMins) endMins += 24 * 60;
        const totalDuration = endMins - startMins;
        const durHours = Math.floor(totalDuration / 60);
        const durMins = totalDuration % 60;
        const durStr = durHours > 0 ? `${durHours}小時${durMins}分` : `${durMins}分`;

        if (route.type === 'direct') {
            const trainInfo = `${route.train1.train} ${route.train1.number}`;
            headerHtml = `
                <div class="result-header">
                    <div>
                        <div class="time-info">${depDisplay} → ${arrDisplay}</div>
                        <div style="color: #00f0ff; font-weight: bold; margin-top: 5px;">${trainInfo}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="duration-info">${durStr}</div>
                        <div class="transfer-info">直達車</div>
                    </div>
                </div>
            `;
            timelineHtml = `
                <div class="timeline">
                    <div class="timeline-item">
                        <div class="timeline-time">${route.departureTime}</div>
                        <div class="timeline-content">
                            <div class="station-name">${stationCodeToName[route.fromStation]} 出發</div>
                            <div style="font-size: 12px; color: #888;">${trainInfo} (開往 ${stationCodeToName[route.train1.info.end] || route.train1.info.end})</div>
                        </div>
                    </div>
                    <div class="timeline-item">
                        <div class="timeline-time">${route.arrivalTime}</div>
                        <div class="timeline-content" style="border-left-color: transparent;">
                            <div class="station-name">${stationCodeToName[route.toStation]} 抵達</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const train1Info = `${route.train1.train} ${route.train1.number}`;
            const train2Info = `${route.train2.train} ${route.train2.number}`;
            headerHtml = `
                <div class="result-header">
                    <div>
                        <div class="time-info">${depDisplay} → ${arrDisplay}</div>
                        <div style="color: #00f0ff; font-weight: bold; margin-top: 5px;">${train1Info} 轉 ${train2Info}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="duration-info">${durStr}</div>
                        <div class="transfer-info">1 次轉乘 (${stationCodeToName[route.transferStation]})</div>
                    </div>
                </div>
            `;

            let transferArrDisp = route.transferArrTime;
            if (route.departureDelay > 0) {
                transferArrDisp = `${route.transferArrTime} (+${route.departureDelay})`;
            }
            let transferDepDisp = route.transferDepTime;
            if (route.arrivalDelay > 0) {
                transferDepDisp = `${route.transferDepTime} (+${route.arrivalDelay})`;
            }

            timelineHtml = `
                <div class="timeline">
                    <div class="timeline-item">
                        <div class="timeline-time">${route.departureTime}</div>
                        <div class="timeline-content">
                            <div class="station-name">${stationCodeToName[route.fromStation]} 出發</div>
                            <div style="font-size: 12px; color: #888;">${train1Info} (開往 ${stationCodeToName[route.train1.info.end] || route.train1.info.end})</div>
                        </div>
                    </div>
                    
                    <div class="transfer-wait">
                        ${stationCodeToName[route.transferStation]} 轉乘 (等待約 ${route.transferWaitActual} 分鐘)<br>
                        <span style="color:#888; font-size:11px;">抵達: ${transferArrDisp} / 下班發車: ${transferDepDisp}</span>
                    </div>

                    <div class="timeline-item">
                        <div class="timeline-time">${route.transferDepTime}</div>
                        <div class="timeline-content">
                            <div class="station-name">${stationCodeToName[route.transferStation]} 出發</div>
                            <div style="font-size: 12px; color: #888;">${train2Info} (開往 ${stationCodeToName[route.train2.info.end] || route.train2.info.end})</div>
                        </div>
                    </div>

                    <div class="timeline-item">
                        <div class="timeline-time">${route.arrivalTime}</div>
                        <div class="timeline-content" style="border-left-color: transparent;">
                            <div class="station-name">${stationCodeToName[route.toStation]} 抵達</div>
                        </div>
                    </div>
                </div>
            `;
        }

        card.innerHTML = headerHtml + timelineHtml;
        card.addEventListener('click', (e) => {
            // 切換展開狀態
            card.classList.toggle('expanded');
        });

        container.appendChild(card);
    });
}
