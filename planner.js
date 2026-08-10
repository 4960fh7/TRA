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

// Train types to exclude (special/tourist trains)
const excludedTrainTypes = ["團體", "專列", "觀光", "郵輪"];

function isExcludedTrain(trainType) {
    if (!trainType) return false;
    return excludedTrainTypes.some(t => trainType.includes(t));
}

function getTrainColor(trainType) {
    if (!trainType) return "#64748b";
    for (let key in colorPalette) {
        if (trainType.includes(key)) return colorPalette[key];
    }
    return "#00f0ff";
}

function isFastTrain(trainType) {
    if (!trainType) return false;
    return ['新自強', '普悠瑪', '太魯閣', '自強'].some(t => trainType.includes(t));
}

function filterDominatedRoutes(routes) {
    let deleted = new Set();
    
    for (let i = 0; i < routes.length; i++) {
        for (let j = 0; j < routes.length; j++) {
            if (i === j) continue;
            if (deleted.has(i) || deleted.has(j)) continue;

            const r1 = routes[i];
            const r2 = routes[j];
            
            const d1 = r1.type === '1-transfer' ? r1.options[0] : r1;
            const d2 = r2.type === '1-transfer' ? r2.options[0] : r2;
            
            const t1 = d1.trains.map(t => t.trainInfo.number);
            const t2 = d2.trains.map(t => t.trainInfo.number);

            if (t1.length === 1 && t2.length === 2 && t1[0] === t2[1]) {
                if (d2.actualDepMins <= d1.actualDepMins) deleted.add(j);
            }
            if (t1.length === 1 && t2.length === 2 && t1[0] === t2[0]) {
                if (d2.actualArrMins >= d1.actualArrMins) deleted.add(j);
            }
            if (t1.length === 2 && t2.length === 2 && t1[0] === t2[0] && t1[1] !== t2[1]) {
                if (d1.actualArrMins < d2.actualArrMins) {
                    deleted.add(j);
                } else if (d1.actualArrMins === d2.actualArrMins) {
                    if (i < j) deleted.add(j);
                }
            }
            if (t1.length === 1 && t2.length === 3 && t1[0] === t2[0]) {
                if (d2.actualArrMins >= d1.actualArrMins) deleted.add(j);
            }
            if (t1.length === 3 && t2.length === 3 && t1[0] === t2[0] && t1[1] === t2[1] && t1[2] !== t2[2]) {
                if (d1.actualArrMins < d2.actualArrMins) {
                    deleted.add(j);
                } else if (d1.actualArrMins === d2.actualArrMins) {
                    if (i < j) deleted.add(j);
                }
            }
            if (t1.length === 3 && t2.length === 3 && t1[1] === t2[1] && t1[2] === t2[2] && t1[0] !== t2[0]) {
                if (d2.actualDepMins <= d1.actualDepMins) deleted.add(j);
            }
            if (t1.length === 2 && t2.length === 3 && t1[0] === t2[0] && t1[1] === t2[2]) {
                deleted.add(j);
            }
        }
    }
    
    return routes.filter((_, idx) => !deleted.has(idx));
}

// Filter logic
function getFilters() {
    return {
        directOnly: document.getElementById('filter-direct-only').checked,
        eticket: document.getElementById('filter-eticket').checked,
        reserved: document.getElementById('filter-reserved').checked,
        unreserved: document.getElementById('filter-unreserved').checked,
        transferStation: document.getElementById('filter-transfer-station').checked
            ? document.getElementById('filter-transfer-station-input').value.trim()
            : ''
    };
}

function isTrainAllowedByFilter(trainType, filters) {
    if (!trainType) return false;
    if (isExcludedTrain(trainType)) return false;

    // E-ticket filter: exclude 新自強, 太魯閣, 普悠瑪
    if (filters.eticket) {
        if (trainType.includes('新自強') || trainType.includes('太魯閣') || trainType.includes('普悠瑪')) {
            return false;
        }
    }

    // Reserved train filter: exclude 區間, 區間快
    if (filters.reserved) {
        if (trainType.includes('區間')) return false;
    }

    // Unreserved train filter: only 區間, 區間快
    if (filters.unreserved) {
        if (!trainType.includes('區間')) return false;
    }

    return true;
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
    setupAutocomplete('filter-transfer-station-input', 'filter-transfer-suggestions');
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
    const filters = getFilters();

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

        // Filter out excluded train types from schedule
        scheduleData = scheduleData.filter(train => !isExcludedTrain(train.train));

        liveBoardData = {};
        if (shouldFetchLive) {
            let offset = 0;
            let liveRes = null;
            let liveData = null;
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
        
        const directRoutes = findDirectRoutes(fromStr, toStr, userStartMins, filters);
        routes.push(...directRoutes);

        if (!filters.directOnly) {
            const oneTransferRoutes = findOneTransferRoutes(fromStr, toStr, userStartMins, filters);
            routes.push(...oneTransferRoutes);
            
            const twoTransferRoutes = findTwoTransferRoutes(fromStr, toStr, userStartMins, filters);
            routes.push(...twoTransferRoutes);
        }

        routes = filterDominatedRoutes(routes);

        const sortMethod = document.getElementById('sort-method').value;
        
        routes.sort((a, b) => {
            let aArr = a.type === '1-transfer' ? a.options[0].actualArrMins : a.actualArrMins;
            let bArr = b.type === '1-transfer' ? b.options[0].actualArrMins : b.actualArrMins;
            let aDep = a.type === '1-transfer' ? a.options[0].actualDepMins : a.actualDepMins;
            let bDep = b.type === '1-transfer' ? b.options[0].actualDepMins : b.actualDepMins;
            const durA = aArr - aDep;
            const durB = bArr - bDep;
            let aTransfers = a.type === 'direct' ? 0 : (a.type === '1-transfer' ? 1 : 2);
            let bTransfers = b.type === 'direct' ? 0 : (b.type === '1-transfer' ? 1 : 2);

            if (sortMethod === 'departure') {
                if (aDep !== bDep) return aDep - bDep;
                if (aArr !== bArr) return aArr - bArr;
                return durA - durB;
            } else if (sortMethod === 'arrival') {
                if (aArr !== bArr) return aArr - bArr;
                if (aDep !== bDep) return bDep - aDep;
                return aTransfers - bTransfers;
            } else if (sortMethod === 'duration') {
                if (durA !== durB) return durA - durB;
                return aDep - bDep;
            } else if (sortMethod === 'transfers') {
                if (aTransfers !== bTransfers) return aTransfers - bTransfers;
                if (durA !== durB) return durA - durB;
                return aDep - bDep;
            }
            return 0;
        });

        routes = routes.slice(0, 25);
        renderRoutes(routes, container);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="color: #ff4444; text-align: center; padding: 20px;">錯誤: ${e.message}</div>`;
    }
}

function extractStops(train, fromName, toName) {
    const normFrom = normalizeStationName(fromName);
    const normTo = normalizeStationName(toName);
    const stops = train.data || [];
    let result = [];
    
    let fromIdx = -1;
    let toIdx = -1;
    
    for (let i = 0; i < stops.length; i++) {
        const sName = normalizeStationName(stops[i].x);
        if (sName === normFrom && fromIdx === -1) {
            fromIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFrom) ? i + 1 : i;
        }
        if (sName === normTo && fromIdx !== -1 && i > fromIdx && toIdx === -1) {
            toIdx = i;
        }
    }
    
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx <= toIdx) {
        let currentStation = "";
        for (let i = fromIdx; i <= toIdx; i++) {
            const sName = stops[i].x;
            if (sName !== currentStation) {
                let depTime = stops[i].y;
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

function findDirectRoutes(fromName, toName, minDepartureMins, filters) {
    const routes = [];
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
    scheduleData.forEach(train => {
        if (!isTrainAllowedByFilter(train.train, filters)) return;

        let fromDepIdx = -1;
        let toArrIdx = -1;
        
        const stops = train.data || [];
        for (let i = 0; i < stops.length; i++) {
            const stopName = normalizeStationName(stops[i].x);
            if (stopName === normFromName && fromDepIdx === -1) {
                fromDepIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFromName) ? i + 1 : i;
            }
            if (stopName === normToName && fromDepIdx !== -1 && i > fromDepIdx && toArrIdx === -1) {
                toArrIdx = i;
            }
        }

        if (fromDepIdx !== -1 && toArrIdx !== -1 && fromDepIdx < toArrIdx) {
            const depMins = stops[fromDepIdx].y;
            let adjustedDepMins = depMins;
            if (depMins < 4 * 60 && minDepartureMins > 20 * 60) adjustedDepMins += 24 * 60;

            if (adjustedDepMins >= minDepartureMins && adjustedDepMins <= minDepartureMins + 8 * 60) {
                const delay = liveBoardData[train.number] || 0;
                
                let actualDepMins = depMins + delay;
                let arrMins = stops[toArrIdx].y;
                let actualArrMins = arrMins + delay;
                if (actualArrMins < actualDepMins) actualArrMins += 24 * 60;
                
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

function findOneTransferRoutes(fromName, toName, minDepartureMins, filters) {
    const routesMap = {};
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    const normFilterTransfer = filters.transferStation ? normalizeStationName(filters.transferStation) : '';
    
    const fromTrains = [];
    const toTrains = [];

    scheduleData.forEach(train => {
        if (!isTrainAllowedByFilter(train.train, filters)) return;

        const stops = train.data || [];
        let hasFrom = false, hasTo = false;
        let fromDepIdx = -1, toArrIdx = -1;
        
        for (let i = 0; i < stops.length; i++) {
            const stopName = normalizeStationName(stops[i].x);
            if (stopName === normFromName && fromDepIdx === -1) { 
                hasFrom = true; 
                fromDepIdx = (i + 1 < stops.length && normalizeStationName(stops[i+1].x) === normFromName) ? i + 1 : i; 
            }
            if (stopName === normToName && toArrIdx === -1) { 
                hasTo = true; 
                toArrIdx = i; 
            }
        }
        
        if (hasFrom) {
            const depMins = stops[fromDepIdx].y;
            let adjustedDepMins = depMins;
            if (depMins < 4 * 60 && minDepartureMins > 20 * 60) adjustedDepMins += 24 * 60;
            
            if (adjustedDepMins >= minDepartureMins && adjustedDepMins <= minDepartureMins + 8 * 60) {
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
                
                // If filter specifies a transfer station, skip others
                if (normFilterTransfer && normT1ArrStation !== normFilterTransfer) continue;

                let passedDest = false;
                for (let x = t1.fromDepIdx + 1; x <= i; x++) {
                    if (normalizeStationName(t1Stops[x].x) === normToName) {
                        passedDest = true; break;
                    }
                }
                if (passedDest) continue;
                
                for (let j = 0; j < t2.toArrIdx; j++) {
                    if (normalizeStationName(t2Stops[j].x) === normT1ArrStation) {
                        const t2DepIdx = (j + 1 < t2Stops.length && normalizeStationName(t2Stops[j+1].x) === normT1ArrStation) ? j + 1 : j;
                        
                        let passedStart = false;
                        for (let x = t2DepIdx; x <= t2.toArrIdx; x++) {
                            if (normalizeStationName(t2Stops[x].x) === normFromName) {
                                passedStart = true; break;
                            }
                        }
                        if (passedStart) continue;

                        const actualArrMins = t1Stops[i].y + delay1; 
                        const actualDepMins = t2Stops[t2DepIdx].y + delay2; 
                        
                        let waitTime = actualDepMins - actualArrMins;
                        if (waitTime < 0 && actualDepMins < 8 * 60 && actualArrMins > 16 * 60) {
                            waitTime += 24 * 60; 
                        }

                        if (waitTime >= transferThresholdMin && waitTime <= transferThresholdMax) {
                            const key = `${train1.number}_${train2.number}`;
                            
                            let totalDep = t1Stops[t1.fromDepIdx].y + delay1;
                            let totalArr = t2Stops[t2.toArrIdx].y + delay2;
                            if (totalArr < totalDep) totalArr += 24 * 60;

                            const optionData = {
                                transferStation: t1ArrStation,
                                actualDepMins: totalDep,
                                actualArrMins: totalArr,
                                trains: [
                                    { trainInfo: train1, delay: delay1, stops: extractStops(train1, fromName, t1ArrStation) },
                                    { trainInfo: train2, delay: delay2, stops: extractStops(train2, t1ArrStation, toName) }
                                ]
                            };
                            
                            if (!routesMap[key]) {
                                routesMap[key] = {
                                    type: '1-transfer',
                                    options: [optionData],
                                    fromStation: fromName,
                                    toStation: toName
                                };
                            } else {
                                if (!routesMap[key].options.find(o => normalizeStationName(o.transferStation) === normT1ArrStation)) {
                                    routesMap[key].options.push(optionData);
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

function findTwoTransferRoutes(fromName, toName, minDepartureMins, filters) {
    const routesMap = {};
    const normFromName = normalizeStationName(fromName);
    const normToName = normalizeStationName(toName);
    
    const majorStations = ["八堵", "台北", "樹林", "桃園", "中壢", "新竹", "竹南", "苗栗", "豐原", "台中", "彰化", "斗六", "嘉義", "台南", "新左營", "高雄", "屏東", "潮州", "枋寮", "台東", "花蓮", "蘇澳新", "宜蘭", "瑞芳"];
    
    const fastTrainLinks = {};
    scheduleData.forEach(train2 => {
        if (!isTrainAllowedByFilter(train2.train, filters)) return;
        if (!isFastTrain(train2.train)) return;
        const stops = train2.data || [];
        const majorStops = [];
        for (let i = 0; i < stops.length; i++) {
            const sName = normalizeStationName(stops[i].x);
            if (majorStations.some(m => normalizeStationName(m) === sName)) {
                majorStops.push({ name: sName, idx: i, time: stops[i].y });
            }
        }
        for (let i = 0; i < majorStops.length; i++) {
            for (let j = i + 1; j < majorStops.length; j++) {
                const key = majorStops[i].name + "_" + majorStops[j].name;
                if (!fastTrainLinks[key]) fastTrainLinks[key] = [];
                fastTrainLinks[key].push({ train: train2, depIdx: majorStops[i].idx, arrIdx: majorStops[j].idx });
            }
        }
    });

    let fromTrains = [];
    let toTrains = [];
    
    scheduleData.forEach(train => {
        if (!isTrainAllowedByFilter(train.train, filters)) return;

        let fromDepIdx = -1, toArrIdx = -1;
        const stops = train.data || [];
        for (let i = 0; i < stops.length; i++) {
            if (normalizeStationName(stops[i].x) === normFromName && fromDepIdx === -1) fromDepIdx = i;
            if (normalizeStationName(stops[i].x) === normToName && toArrIdx === -1) toArrIdx = i;
        }
        
        if (fromDepIdx !== -1) {
            const depMins = stops[fromDepIdx].y;
            let adj = depMins < 4*60 && minDepartureMins > 20*60 ? depMins + 24*60 : depMins;
            if (adj >= minDepartureMins && adj <= minDepartureMins + 8 * 60) fromTrains.push({ train, fromDepIdx });
        }
        if (toArrIdx !== -1) toTrains.push({ train, toArrIdx });
    });

    fromTrains.forEach(t1 => {
        const train1 = t1.train;
        const delay1 = liveBoardData[train1.number] || 0;
        const stops1 = train1.data;
        
        for (let i = t1.fromDepIdx + 1; i < stops1.length; i++) {
            const hub1 = stops1[i].x;
            const normHub1 = normalizeStationName(hub1);
            if (!majorStations.some(m => normalizeStationName(m) === normHub1)) continue;
            
            toTrains.forEach(t3 => {
                const train3 = t3.train;
                if (train1.number === train3.number) return;
                
                for (let l = 0; l < t3.toArrIdx; l++) {
                    const hub2 = train3.data[l].x;
                    const normHub2 = normalizeStationName(hub2);
                    if (!majorStations.some(m => normalizeStationName(m) === normHub2)) continue;
                    
                    const key = normHub1 + "_" + normHub2;
                    if (fastTrainLinks[key]) {
                        fastTrainLinks[key].forEach(link => {
                            const train2 = link.train;
                            if (train2.number === train1.number || train2.number === train3.number) return;
                            
                            const delay2 = liveBoardData[train2.number] || 0;
                            const stops2 = train2.data;
                            const delay3 = liveBoardData[train3.number] || 0;
                            const stops3 = train3.data;
                            
                            const t1ArrActual = stops1[i].y + delay1;
                            let t2DepActual = stops2[link.depIdx].y + delay2;
                            let wait1 = t2DepActual - t1ArrActual;
                            if (wait1 < 0) wait1 += 24*60;
                            if (wait1 < 5 || wait1 > 60) return;
                            
                            const t2ArrActual = stops2[link.arrIdx].y + delay2;
                            let t3DepActual = stops3[l].y + delay3;
                            let wait2 = t3DepActual - t2ArrActual;
                            if (wait2 < 0) wait2 += 24*60;
                            if (wait2 < 5 || wait2 > 60) return;
                            
                            const routeKey = `${train1.number}_${train2.number}_${train3.number}`;
                            if (!routesMap[routeKey]) {
                                let totalDep = stops1[t1.fromDepIdx].y + delay1;
                                let totalArr = stops3[t3.toArrIdx].y + delay3;
                                if (totalArr < totalDep) totalArr += 24 * 60;
                                
                                routesMap[routeKey] = {
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
                }
            });
        }
    });

    return Object.values(routesMap);
}

function buildTimelineHtml(routeData) {
    let html = '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #1a2a3a;">';
    
    // Flatten all rows (stops + transfer markers) into a single list
    let rows = [];
    
    routeData.trains.forEach((segment, tIndex) => {
        const trainInfo = segment.trainInfo;
        const tColor = getTrainColor(trainInfo.train);
        const stops = segment.stops;
        if (!stops || stops.length === 0) return;
        
        // Transfer marker between segments
        if (tIndex > 0) {
            const prevSegment = routeData.trains[tIndex - 1];
            if (prevSegment.stops && prevSegment.stops.length > 0) {
                const prevArr = prevSegment.stops[prevSegment.stops.length - 1].timeMins + prevSegment.delay;
                const nextDep = stops[0].timeMins + segment.delay;
                let wait = nextDep - prevArr;
                if (wait < 0) wait += 24 * 60;
                rows.push({
                    type: 'transfer',
                    lineColor: '#ff9800',
                    lineDashed: true,
                    text: `${stops[0].station} 轉乘 (等待約 ${Math.round(wait)} 分鐘)`,
                    subtext: `抵達: ${minutesToTime(prevArr)} / 下班發車: ${minutesToTime(nextDep)}`
                });
            }
        }

        // Station stops
        stops.forEach((stop, sIndex) => {
            const isFirst = (sIndex === 0);
            const isLast = (sIndex === stops.length - 1);
            const isEndpoint = isFirst || isLast;
            
            let timeDisplay = stop.timeStr;
            let delayedTimeDisplay = '';
            if (segment.delay > 0) {
                const adjMins = stop.timeMins + segment.delay;
                delayedTimeDisplay = minutesToTime(adjMins);
            }

            let actionText = "";
            if (isFirst) actionText = `出發 <span style="font-size:11px; color:#888;">(開往 ${trainInfo.info.end})</span>`;
            else if (isLast) actionText = `抵達`;

            // Determine the line going DOWN from this row
            let lineColor = tColor;
            let lineDashed = false;
            let hasLine = true;
            if (isLast && tIndex < routeData.trains.length - 1) {
                lineColor = '#ff9800';
                lineDashed = true;
            } else if (isLast) {
                hasLine = false; // last stop of last segment - no line below
            }

            rows.push({
                type: 'stop',
                timeStr: timeDisplay,
                delayedTimeStr: delayedTimeDisplay,
                station: stop.station,
                actionText: actionText,
                isEndpoint: isEndpoint,
                dotColor: isEndpoint ? tColor : '#64748b',
                dotSize: isEndpoint ? 10 : 7,
                hasLine: hasLine,
                lineColor: lineColor,
                lineDashed: lineDashed
            });
        });
    });

    // Render rows
    // Each stop needs a line ABOVE the dot (from the previous stop) and a line BELOW the dot (to the next stop).
    // We track what the previous row's "line going down" was so we can draw it above the current dot.
    let prevLineDown = null; // { color, dashed } or null

    rows.forEach((row, rowIdx) => {
        if (row.type === 'transfer') {
            // Transfer row: dashed line running full height, text on the right
            // prevLineDown from the last stop already covered the dashed line into this area,
            // but we still need a continuous dashed line here.
            html += `
                <div style="display: flex; align-items: stretch; min-height: 40px;">
                    <div style="width: 56px; flex-shrink: 0; box-sizing: border-box; padding-right: 4px;"></div>
                    <div style="width: 18px; flex-shrink: 0; position: relative;">
                        <div style="position: absolute; left: 50%; top: 0; bottom: 0; transform: translateX(-50%); width: 2px; background: repeating-linear-gradient(to bottom, ${row.lineColor} 0px, ${row.lineColor} 4px, transparent 4px, transparent 8px);"></div>
                    </div>
                    <div style="flex: 1; padding: 4px 0 4px 10px; display: flex; align-items: center;">
                        <div style="color: #ff9800; font-size: 12px; line-height: 1.4;">
                            ${row.text}
                        </div>
                    </div>
                </div>
            `;
            // The line going down from transfer is dashed orange (to the next stop's "above" area)
            prevLineDown = { color: row.lineColor, dashed: true };
        } else {
            // Stop row
            let timeHtml = '';
            if (row.delayedTimeStr) {
                timeHtml = `<span style="text-decoration: line-through; color: #888; font-size: 11px;">${row.timeStr}</span><br><span style="color: #ff4444; font-size: 13px;">${row.delayedTimeStr}</span>`;
            } else {
                timeHtml = row.timeStr;
            }

            // Line above dot (connecting from previous row)
            let lineAboveHtml = '';
            if (prevLineDown) {
                if (prevLineDown.dashed) {
                    lineAboveHtml = `<div style="position: absolute; left: 50%; top: 0; height: 50%; transform: translateX(-50%); width: 2px; background: repeating-linear-gradient(to bottom, ${prevLineDown.color} 0px, ${prevLineDown.color} 4px, transparent 4px, transparent 8px);"></div>`;
                } else {
                    lineAboveHtml = `<div style="position: absolute; left: 50%; top: 0; height: 50%; transform: translateX(-50%); width: 2px; background: ${prevLineDown.color};"></div>`;
                }
            }

            // Line below dot (going to next row)
            let lineBelowHtml = '';
            if (row.hasLine) {
                if (row.lineDashed) {
                    lineBelowHtml = `<div style="position: absolute; left: 50%; top: 50%; bottom: 0; transform: translateX(-50%); width: 2px; background: repeating-linear-gradient(to bottom, ${row.lineColor} 0px, ${row.lineColor} 4px, transparent 4px, transparent 8px);"></div>`;
                } else {
                    lineBelowHtml = `<div style="position: absolute; left: 50%; top: 50%; bottom: 0; transform: translateX(-50%); width: 2px; background: ${row.lineColor};"></div>`;
                }
            }

            html += `
                <div style="display: flex; align-items: stretch; min-height: 24px;">
                    <div style="width: 56px; flex-shrink: 0; box-sizing: border-box; color: #ccc; font-size: 13px; display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; line-height: 1.3;">${timeHtml}</div>
                    <div style="width: 18px; flex-shrink: 0; position: relative;">
                        ${lineAboveHtml}
                        ${lineBelowHtml}
                        <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: ${row.dotSize}px; height: ${row.dotSize}px; border-radius: 50%; background: ${row.dotColor}; z-index: 2;"></div>
                    </div>
                    <div style="flex: 1; padding: 4px 0 4px 10px; display: flex; align-items: center;">
                        <div style="color: ${row.isEndpoint ? '#fff' : '#aaa'}; font-size: ${row.isEndpoint ? '14px' : '13px'}; line-height: 1.3;">${row.station} ${row.actionText}</div>
                    </div>
                </div>
            `;

            // Track what line goes down from this row for the next row's "above" line
            if (row.hasLine) {
                prevLineDown = { color: row.lineColor, dashed: row.lineDashed };
            } else {
                prevLineDown = null;
            }
        }
    });

    html += '</div>';
    return html;
}

function renderRoutes(routes, container) {
    container.innerHTML = '';
    
    if (routes.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">找不到符合條件的路線</div>';
        return;
    }

    routes.forEach((route, index) => {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.style.cursor = 'pointer';
        
        let routeData = route.type === '1-transfer' ? route.options[0] : route;
        
        const totalDep = routeData.actualDepMins;
        const totalArr = routeData.actualArrMins;
        const totalDur = Math.round(totalArr - totalDep);
        
        const hrs = Math.floor(totalDur / 60);
        const mins = totalDur % 60;
        let durStr = '';
        if (hrs > 0) {
            durStr = `<span style="color:#00f0ff; font-weight:bold;">${hrs}</span> hr <span style="color:#00f0ff; font-weight:bold;">${mins}</span> min`;
        } else {
            durStr = `<span style="color:#00f0ff; font-weight:bold;">${mins}</span> min`;
        }

        let trainsSummary = routeData.trains.map(t => `<span style="color:${getTrainColor(t.trainInfo.train)}">${t.trainInfo.train} ${t.trainInfo.number}</span>`).join(' 轉 ');
        let transferText = route.type === 'direct' ? '直達車' : (route.type === '1-transfer' ? `1次轉乘` : `2次轉乘`);

        let hasDelay = routeData.trains.some(t => t.delay > 0);
        let delayBadge = hasDelay ? `<span style="color: #ff4444; font-size: 12px; font-weight: bold; margin-left: 5px;">(延誤)</span>` : '';

        // Show original time and delayed time in header if delay
        let depTimeStr = minutesToTime(totalDep);
        let arrTimeStr = minutesToTime(totalArr);
        let headerTimeHtml = '';
        if (hasDelay) {
            // Compute original times (without delay)
            const origDep = routeData.trains[0].trainInfo.data ? routeData.trains[0].stops[0].timeMins : totalDep;
            const lastTrain = routeData.trains[routeData.trains.length - 1];
            const origArr = lastTrain.stops && lastTrain.stops.length > 0 ? lastTrain.stops[lastTrain.stops.length - 1].timeMins : totalArr;
            
            if (origDep !== totalDep || origArr !== totalArr) {
                headerTimeHtml = `<span style="text-decoration: line-through; color: #888; font-size: 16px;">${minutesToTime(origDep)} → ${minutesToTime(origArr)}</span> <span style="color: #ff4444;">${depTimeStr} → ${arrTimeStr}</span>${delayBadge}`;
            } else {
                headerTimeHtml = `${depTimeStr} → ${arrTimeStr}${delayBadge}`;
            }
        } else {
            headerTimeHtml = `${depTimeStr} → ${arrTimeStr}`;
        }

        let headerHtml = `
            <div class="result-header">
                <div>
                    <div class="time-info">${headerTimeHtml}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 5px;">${trainsSummary}</div>
                </div>
                <div style="text-align: right;">
                    <div class="duration-info">${durStr}</div>
                    <div class="transfer-info">${transferText}</div>
                </div>
            </div>
        `;

        let bodyWrapper = document.createElement('div');
        bodyWrapper.className = 'route-details';
        bodyWrapper.style.display = 'none';

        if (route.type === '1-transfer' && route.options.length > 1) {
            let selectHtml = `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #1a2a3a;">
                <label style="color: #ccc; font-size: 12px; margin-right: 10px;">選擇換乘車站:</label>
                <select class="transfer-select planner-input custom-scrollbar" style="width: auto; padding: 5px; font-size: 12px; display: inline-block; font-family: inherit;">
                    ${route.options.map((opt, i) => `<option value="${i}">${opt.transferStation}</option>`).join('')}
                </select>
            </div>`;
            
            let timelineContainer = document.createElement('div');
            timelineContainer.innerHTML = buildTimelineHtml(route.options[0]);
            
            bodyWrapper.innerHTML = selectHtml;
            bodyWrapper.appendChild(timelineContainer);
            
            let selectElem = bodyWrapper.querySelector('select');
            selectElem.addEventListener('change', (e) => {
                const optIdx = parseInt(e.target.value, 10);
                timelineContainer.innerHTML = buildTimelineHtml(route.options[optIdx]);
            });
            selectElem.addEventListener('click', (e) => e.stopPropagation());
        } else {
            bodyWrapper.innerHTML = buildTimelineHtml(routeData);
        }

        card.innerHTML = headerHtml;
        card.appendChild(bodyWrapper);

        card.addEventListener('click', () => {
            if (bodyWrapper.style.display === 'none') {
                bodyWrapper.style.display = 'block';
                card.style.borderColor = '#00f0ff';
            } else {
                bodyWrapper.style.display = 'none';
                card.style.borderColor = '#1a2a3a';
            }
        });

        container.appendChild(card);
    });
}
