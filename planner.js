let stations = [];
let stationCodeToName = {};
let stationNameToCode = {};
let scheduleData = [];
let liveBoardData = {};

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

function getTrainColor(trainType) {
    if (!trainType) return "#64748b";
    for (let key in colorPalette) {
        if (trainType.includes(key)) return colorPalette[key];
    }
    return "#00f0ff"; // default
}

document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    
    document.getElementById('travel-date').value = `${yyyy}-${mm}-${dd}`;
    document.getElementById('travel-time').value = `${hh}:${min}`;

    await loadStations();

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

function normalizeStationName(name) {
    if (!name) return "";
    return name.replace(/臺/g, '台');
}

function setupAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener('input', () => {
        const val = normalizeStationName(input.value.trim());
        dropdown.innerHTML = '';
        if (!val) {
            dropdown.classList.remove('active');
            return;
        }

        const matches = stations.filter(s => normalizeStationName(s.stationName).includes(val) || s.stationCode.includes(val));
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

function getLatestTDXUrl(targetDate) {
    const now = new Date();
    if (targetDate.toDateString() !== now.toDateString()) {
        return null; 
    }
    return true; 
}

function getScheduleUrl(dateStr) {
    const fullDateStr = dateStr.replace(/-/g, '');
    return `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${fullDateStr}.json`;
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

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

    if (!fromStr || !toStr) {
        alert("請輸入出發與抵達車站");
        return;
    }

    if (normalizeStationName(fromStr) === normalizeStationName(toStr)) {
        alert("出發站與抵達站不能相同");
        return;
    }

    const container = document.getElementById('results-container');
    container.innerHTML = '<div class="loading-text">正在查詢路線與即時動態...</div>';

    try {
        const targetDate = new Date(dateStr);
        const scheduleUrl = getScheduleUrl(dateStr);
        const shouldFetchLive = getLatestTDXUrl(targetDate);

        const schedRes = await fetch(scheduleUrl);
        if (!schedRes.ok) throw new Error("無法取得該日期的時刻表");
        scheduleData = await schedRes.json();

        liveBoardData = {};
        if (shouldFetchLive) {
            let offset = 0;
            let liveRes = null;
            let liveData = null;
            // 嘗試抓取即時動態，若失敗則遞減5分鐘重試 (最多試12次 = 1小時)
            while (offset <= 60) {
                const retryDate = new Date(new Date().getTime() - offset * 60000);
                const retryMonth = String(retryDate.getMonth() + 1).padStart(2, '0');
                const retryDay = String(retryDate.getDate()).padStart(2, '0');
                const retryHour = String(retryDate.getHours()).padStart(2, '0');
                const retryMin = String(Math.floor(retryDate.getMinutes() / 5) * 5).padStart(2, '0');
                const retryUrl = `https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/data/data_${retryMonth}${retryDay}${retryHour}${retryMin}.json?t=${new Date().getTime()}`;
                
                try {
                    liveRes = await fetch(retryUrl);
                    if (liveRes.ok) {
                        liveData = await liveRes.json();
                        break;
                    }
                } catch(e) {}
                offset += 5;
            }
            
            if (liveData && Array.isArray(liveData)) {
                liveData.forEach(t => {
                    liveBoardData[t.TrainNo || t.No] = parseInt(t.Delay || 0, 10);
                });
            }
        }

        const userStartMins = timeToMinutes(timeStr);
        
        let routes = [];
        
        // 1. 直達車
        const directRoutes = findDirectRoutes(fromStr, toStr, userStartMins);
        routes.push(...directRoutes);

        // 2. 轉乘車
        if (!directOnly) {
            const oneTransferRoutes = findOneTransferRoutes(fromStr, toStr, userStartMins);
            routes.push(...oneTransferRoutes);
            
            // 如果直達 + 1次轉乘的結果太少，或是找不到理想結果，則尋找 2 次轉乘
            if (routes.length < 5) {
                const twoTransferRoutes = findTwoTransferRoutes(fromStr, toStr, userStartMins);
                routes.push(...twoTransferRoutes);
            }
        }

        // 過濾並排序
        routes.sort((a, b) => {
            if (a.actualArrMins !== b.actualArrMins) return a.actualArrMins - b.actualArrMins;
            const durA = a.actualArrMins - a.actualDepMins;
            const durB = b.actualArrMins - b.actualDepMins;
            return durA - durB;
        });

        routes = routes.slice(0, 25);

        renderRoutes(routes, container);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="color: #ff4444; text-align: center; padding: 20px;">錯誤: ${e.message}</div>`;
    }
}

// 取得該班車從 fromName 到 toName 的停靠站列表 (包含起訖)
function extractStops(train, fromName, toName) {
    const normFrom = normalizeStationName(fromName);
    const normTo = normalizeStationName(toName);
    const stops = train.data || [];
    let result = [];
    
    let fromIdx = -1;
    let toIdx = -1;
    
    for (let i = 0; i < stops.length; i++) {
        const sName = normalizeStationName(stops[i].x);
        if (sName === normFrom) {
            // 發車是最後一筆
            fromIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFrom) ? i + 1 : i;
        }
        if (sName === normTo && toIdx === -1) {
            // 抵達是第一筆
            toIdx = i;
        }
    }
    
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx <= toIdx) {
        let currentStation = "";
        for (let i = fromIdx; i <= toIdx; i++) {
            const sName = stops[i].x;
            if (sName !== currentStation) {
                let depTime = stops[i].y;
                // 若這站有兩筆，第二筆是出發時間 (除了終點站)
                if (i + 1 <= toIdx && stops[i+1].x === sName) {
                    depTime = stops[i+1].y;
                    i++; 
                }
                result.push({
                    station: sName,
                    timeMins: depTime, 
                    timeStr: minutesToTime(depTime)
                });
                currentStation = sName;
            }
        }
    }
    return result;
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

        if (fromDepIdx !== -1 && toArrIdx !== -1 && fromDepIdx < toArrIdx) {
            const depMins = stops[fromDepIdx].y;
            let adjustedDepMins = depMins;
            if (depMins < 4 * 60 && minDepartureMins > 20 * 60) adjustedDepMins += 24 * 60;

            if (adjustedDepMins >= minDepartureMins) {
                const delay = liveBoardData[train.number] || 0;
                
                let actualDepMins = depMins + delay;
                let arrMins = stops[toArrIdx].y;
                let actualArrMins = arrMins + delay;
                if (actualArrMins < actualDepMins) actualArrMins += 24 * 60; // 跨夜
                
                const intermediateStops = extractStops(train, fromName, toName);

                routes.push({
                    type: 'direct',
                    trains: [{
                        trainInfo: train,
                        delay: delay,
                        stops: intermediateStops
                    }],
                    fromStation: fromName,
                    toStation: toName,
                    actualDepMins: actualDepMins,
                    actualArrMins: actualArrMins
                });
            }
        }
    });
    return routes;
}

function findOneTransferRoutes(fromName, toName, minDepartureMins) {
    const routesMap = {};
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
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
        if (hasTo) toTrains.push({ train, toArrIdx });
    });

    const transferThresholdMin = 5;
    const transferThresholdMax = 90; 

    fromTrains.forEach(t1 => {
        const train1 = t1.train;
        const delay1 = liveBoardData[train1.number] || 0;
        const t1Stops = train1.data;

        toTrains.forEach(t2 => {
            const train2 = t2.train;
            if (train1.number === train2.number) return; 
            const delay2 = liveBoardData[train2.number] || 0;
            const t2Stops = train2.data;

            for (let i = t1.fromDepIdx + 1; i < t1Stops.length; i++) {
                const t1ArrStation = t1Stops[i].x;
                const normT1ArrStation = normalizeStationName(t1ArrStation);
                if (i > 0 && normalizeStationName(t1Stops[i-1].x) === normT1ArrStation) continue; 
                
                for (let j = 0; j < t2.toArrIdx; j++) {
                    if (normalizeStationName(t2Stops[j].x) === normT1ArrStation) {
                        const t2DepIdx = (j + 1 < t2Stops.length && normalizeStationName(t2Stops[j+1].x) === normT1ArrStation) ? j + 1 : j;
                        
                        const actualArrMins = t1Stops[i].y + delay1; 
                        const actualDepMins = t2Stops[t2DepIdx].y + delay2; 
                        
                        let waitTime = actualDepMins - actualArrMins;
                        if (waitTime < 0 && actualDepMins < 8 * 60 && actualArrMins > 16 * 60) {
                            waitTime += 24 * 60; 
                        }

                        if (waitTime >= transferThresholdMin && waitTime <= transferThresholdMax) {
                            const key = `${train1.number}_${train2.number}`;
                            
                            if (!routesMap[key]) {
                                let totalDep = t1Stops[t1.fromDepIdx].y + delay1;
                                let totalArr = t2Stops[t2.toArrIdx].y + delay2;
                                if (totalArr < totalDep) totalArr += 24 * 60;
                                
                                routesMap[key] = {
                                    type: '1-transfer',
                                    trains: [
                                        { trainInfo: train1, delay: delay1, stops: extractStops(train1, fromName, t1ArrStation) },
                                        { trainInfo: train2, delay: delay2, stops: extractStops(train2, t1ArrStation, toName) }
                                    ],
                                    fromStation: fromName,
                                    toStation: toName,
                                    actualDepMins: totalDep,
                                    actualArrMins: totalArr,
                                    transferStations: [t1ArrStation],
                                    totalWaitTime: waitTime
                                };
                            } else {
                                // 合併相同班次的轉乘車站
                                if (!routesMap[key].transferStations.includes(t1ArrStation)) {
                                    routesMap[key].transferStations.push(t1ArrStation);
                                }
                            }
                        }
                    }
                }
            }
        });
    });

    return Object.values(routesMap);
}

function findTwoTransferRoutes(fromName, toName, minDepartureMins) {
    // 簡化的2次轉乘搜尋，避免效能問題。
    // 我們可以藉由一級轉乘大站(如 新竹, 彰化, 台北, 花蓮, 新左營, 八堵) 來做中介
    const routesMap = {};
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
    // 只找特定大站作為轉乘樞紐
    const majorStations = ["八堵", "台北", "樹林", "桃園", "中壢", "新竹", "竹南", "苗栗", "豐原", "台中", "彰化", "斗六", "嘉義", "台南", "新左營", "高雄", "屏東", "潮州", "枋寮", "台東", "花蓮", "蘇澳新", "宜蘭", "瑞芳"];
    
    let fromTrains = [];
    let toTrains = [];
    
    // 收集所有出發與抵達班次
    scheduleData.forEach(train => {
        let fromDepIdx = -1, toArrIdx = -1;
        const stops = train.data || [];
        for (let i = 0; i < stops.length; i++) {
            if (normalizeStationName(stops[i].x) === normFromName) fromDepIdx = i;
            if (normalizeStationName(stops[i].x) === normToName && toArrIdx === -1) toArrIdx = i;
        }
        
        if (fromDepIdx !== -1) {
            const depMins = stops[fromDepIdx].y;
            let adj = depMins < 4*60 && minDepartureMins > 20*60 ? depMins + 24*60 : depMins;
            if (adj >= minDepartureMins) fromTrains.push({ train, fromDepIdx });
        }
        if (toArrIdx !== -1) toTrains.push({ train, toArrIdx });
    });

    // 針對每一個從出發站出發的火車，找到它會經過的大站
    fromTrains.forEach(t1 => {
        const train1 = t1.train;
        const delay1 = liveBoardData[train1.number] || 0;
        const stops1 = train1.data;
        
        // 尋找 t1 的所有可能的一級轉乘站
        for (let i = t1.fromDepIdx + 1; i < stops1.length; i++) {
            const hub1 = stops1[i].x;
            const normHub1 = normalizeStationName(hub1);
            if (!majorStations.some(m => normalizeStationName(m) === normHub1)) continue;
            
            // 找到 Hub1 後，尋找經過 Hub1 且能前往另一個大站 Hub2 或直達終點的車 (中段車 train2)
            scheduleData.forEach(train2 => {
                if (train1.number === train2.number) return;
                const delay2 = liveBoardData[train2.number] || 0;
                const stops2 = train2.data || [];
                
                let hub1DepIdx = -1;
                for (let j = 0; j < stops2.length; j++) {
                    if (normalizeStationName(stops2[j].x) === normHub1) { hub1DepIdx = j; break; }
                }
                if (hub1DepIdx === -1) return;
                
                // 檢查 T1 -> T2 轉乘時間
                const t1ArrActual = stops1[i].y + delay1;
                let t2DepActual = stops2[hub1DepIdx].y + delay2;
                let wait1 = t2DepActual - t1ArrActual;
                if (wait1 < 0) wait1 += 24*60;
                if (wait1 < 5 || wait1 > 60) return;
                
                // 尋找 T2 到達的 Hub2
                for (let k = hub1DepIdx + 1; k < stops2.length; k++) {
                    const hub2 = stops2[k].x;
                    const normHub2 = normalizeStationName(hub2);
                    
                    // 從 Hub2 尋找能到終點的 T3
                    toTrains.forEach(t3 => {
                        const train3 = t3.train;
                        if (train3.number === train2.number || train3.number === train1.number) return;
                        const delay3 = liveBoardData[train3.number] || 0;
                        const stops3 = train3.data;
                        
                        let hub2DepIdx = -1;
                        for (let l = 0; l < t3.toArrIdx; l++) {
                            if (normalizeStationName(stops3[l].x) === normHub2) { hub2DepIdx = l; break; }
                        }
                        if (hub2DepIdx === -1) return;
                        
                        // 檢查 T2 -> T3 轉乘時間
                        const t2ArrActual = stops2[k].y + delay2;
                        let t3DepActual = stops3[hub2DepIdx].y + delay3;
                        let wait2 = t3DepActual - t2ArrActual;
                        if (wait2 < 0) wait2 += 24*60;
                        if (wait2 < 5 || wait2 > 60) return;
                        
                        const key = `${train1.number}_${train2.number}_${train3.number}`;
                        if (!routesMap[key]) {
                            let totalDep = stops1[t1.fromDepIdx].y + delay1;
                            let totalArr = stops3[t3.toArrIdx].y + delay3;
                            if (totalArr < totalDep) totalArr += 24 * 60;
                            
                            routesMap[key] = {
                                type: '2-transfer',
                                trains: [
                                    { trainInfo: train1, delay: delay1, stops: extractStops(train1, fromName, hub1) },
                                    { trainInfo: train2, delay: delay2, stops: extractStops(train2, hub1, hub2) },
                                    { trainInfo: train3, delay: delay3, stops: extractStops(train3, hub2, toName) }
                                ],
                                fromStation: fromName,
                                toStation: toName,
                                actualDepMins: totalDep,
                                actualArrMins: totalArr,
                                transferStations: [hub1, hub2]
                            };
                        }
                    });
                }
            });
        }
    });

    return Object.values(routesMap);
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
        let timelineHtml = '<div class="timeline">';
        
        const totalDep = route.actualDepMins;
        const totalArr = route.actualArrMins;
        const totalDur = totalArr - totalDep;
        const durStr = Math.floor(totalDur / 60) > 0 ? `${Math.floor(totalDur / 60)}小時${totalDur % 60}分` : `${totalDur % 60}分`;

        // Generate Header
        let trainsSummary = route.trains.map(t => `<span style="color:${getTrainColor(t.trainInfo.train)}">${t.trainInfo.train} ${t.trainInfo.number}</span>`).join(' 轉 ');
        
        let transferText = route.type === 'direct' ? '直達車' : 
                           (route.type === '1-transfer' ? `1次轉乘 (可於 ${route.transferStations.join('/')} 轉乘)` :
                           `2次轉乘`);

        headerHtml = `
            <div class="result-header">
                <div>
                    <div class="time-info">${minutesToTime(totalDep)} → ${minutesToTime(totalArr)}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 5px;">${trainsSummary}</div>
                </div>
                <div style="text-align: right;">
                    <div class="duration-info">${durStr}</div>
                    <div class="transfer-info">${transferText}</div>
                </div>
            </div>
        `;

        // Generate Timeline (Detailed stops)
        route.trains.forEach((segment, tIndex) => {
            const trainInfo = segment.trainInfo;
            const tColor = getTrainColor(trainInfo.train);
            const stops = segment.stops;
            
            if (tIndex > 0) {
                // Render Transfer Wait
                const prevSegment = route.trains[tIndex - 1];
                const prevArr = prevSegment.stops[prevSegment.stops.length - 1].timeMins + prevSegment.delay;
                const nextDep = stops[0].timeMins + segment.delay;
                let wait = nextDep - prevArr;
                if (wait < 0) wait += 24 * 60;
                timelineHtml += `
                    <div class="transfer-wait">
                        ${stops[0].station} 轉乘 (等待約 ${wait} 分鐘)<br>
                        <span style="color:#888; font-size:11px;">抵達: ${minutesToTime(prevArr)} / 下班發車: ${minutesToTime(nextDep)}</span>
                    </div>
                `;
            }

            // Render all stops in this segment
            stops.forEach((stop, sIndex) => {
                let displayTime = stop.timeStr;
                if (segment.delay > 0) {
                    const adjMins = stop.timeMins + segment.delay;
                    displayTime = `<span class="strikethrough">${stop.timeStr}</span> <span class="delay-text" style="color: #ff4444;">${minutesToTime(adjMins)} (+${segment.delay}分)</span>`;
                }

                let dotColor = (sIndex === 0 || sIndex === stops.length - 1) ? tColor : '#64748b';
                let borderStyle = (sIndex === stops.length - 1) ? 'transparent' : `2px solid ${tColor}`;

                let actionText = "";
                if (sIndex === 0) actionText = `出發 <span style="font-size:11px; color:#888;">(開往 ${trainInfo.info.end})</span>`;
                else if (sIndex === stops.length - 1) actionText = `抵達`;
                
                timelineHtml += `
                    <div class="timeline-item">
                        <div class="timeline-time">${displayTime}</div>
                        <div class="timeline-content" style="border-left: ${borderStyle};">
                            <div style="position: absolute; left: -6px; top: 0; width: 10px; height: 10px; border-radius: 50%; background: ${dotColor};"></div>
                            <div class="station-name" style="color:${(sIndex === 0 || sIndex === stops.length - 1) ? '#fff' : '#ccc'}">${stop.station} ${actionText}</div>
                        </div>
                    </div>
                `;
            });
        });

        timelineHtml += '</div>';

        card.innerHTML = headerHtml + timelineHtml;
        card.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        container.appendChild(card);
    });
}
