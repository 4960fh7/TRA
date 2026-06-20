const width = 800;
const height = 800;

const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

const mainGroup = svg.append("g");

const projection = d3.geoMercator()
    .center([121, 23.6])
    .scale(9000)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);
const tooltip = d3.select("#tooltip");
const mapUrl = "counties.json";

let activeStationSelection = null;
let globalStationsData = [];
let globalScheduleData = []; // Cache full schedule lookup tables globally

// 全域追蹤狀態
let currentActiveStationCode = null;
let currentActiveStationName = null;
let currentActiveStationAddress = null;
let currentActiveStationCW = null;
let currentActiveStationCCW = null;

// Sci-Fi 列車顏色調色盤
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

// 全域力學模擬器變數 (已廢棄，使用高性能靜態防重疊演算法)
let labelSimulation = null;

// 縮放設定行為邏輯
const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
        const k = event.transform.k;

        mainGroup.selectAll(".station")
            .attr("r", d => {
                const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
                return Math.max(0.6, base / Math.sqrt(k));
            })
            .style("stroke-width", `${0.3 / k}px`);

        mainGroup.selectAll(".station-label").style("opacity", 1);
        updateLabelForceSimulation(k);
    });

svg.call(zoom);

// 高性能靜態防重疊邊界判定算法
function updateLabelForceSimulation(k) {
    if (labelSimulation) {
        labelSimulation.stop();
        labelSimulation = null;
    }

    const fontSize = Math.max(2.5, 9 / Math.sqrt(k));
    const activeCircleRadius = 4 / Math.sqrt(k);
    const standardCircleRadius = 3 / Math.sqrt(k);

    const labels = mainGroup.selectAll(".station-label")
        .style("font-size", `${fontSize}px`);

    const allocatedBoxes = [];

    let nodes = globalStationsData.map(d => {
        const coords = getCoords(d);
        if (!coords) return null;
        const pos = projection([coords.lon, coords.lat]);

        const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
        const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;

        const name = getStationName(d);
        const estWidth = name.length * fontSize * 1.1;
        const estHeight = fontSize * 1.2;

        return {
            data: d,
            geoX: pos[0],
            geoY: pos[1],
            name: name,
            r: r,
            width: estWidth,
            height: estHeight,
            priority: isCurrentActive ? 3 : (d.isConnectedState ? 2 : 1),
            trainCount: d.trainCount || 0
        };
    }).filter(n => n !== null);

    const searchRadius = 40 / Math.pow(k, 0.8);

    // 1. 計算每個站點是否為區域最大值 (Local Maximum)
    nodes.forEach(node => {
        if (node.priority === 3) {
            node.isLocalMax = true;
            return;
        }

        let isMax = true;
        for (let other of nodes) {
            if (other === node) continue;

            const dist = Math.hypot(node.geoX - other.geoX, node.geoY - other.geoY);
            if (dist < searchRadius) {
                if (other.trainCount > node.trainCount) {
                    isMax = false;
                    break;
                } else if (other.trainCount === node.trainCount) {
                    if (other.name > node.name) {
                        isMax = false;
                        break;
                    }
                }
            }
        }
        node.isLocalMax = isMax;
    });

    nodes.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.trainCount - a.trainCount;
    });

    // 2. 結合全域 Top N (Global Maximum) 與 區域最大值
    const maxAllowed = Math.floor(25 * Math.pow(k, 1.3));
    let allowedCount = 0;

    nodes.forEach(node => {
        let isTopN = false;
        if (node.priority !== 3 && allowedCount < maxAllowed) {
            isTopN = true;
            allowedCount++;
        }

        // 允許顯示的條件：目前選擇的站點 OR 全域 Top N OR 區域最大值
        node.isAllowed = node.priority === 3 || isTopN || node.isLocalMax;
    });

    // 將所有車站圓圈加入已分配的盒子中，作為障礙物
    nodes.forEach(node => {
        allocatedBoxes.push({
            x1: node.geoX - node.r,
            x2: node.geoX + node.r,
            y1: node.geoY - node.r,
            y2: node.geoY + node.r,
            data: node.data,
            isCircle: true
        });
    });

    const gap = 1 / k; // 基礎間隙

    const slotDirections = [
        { dx: 0, dy: -1 }, // 上
        { dx: 0, dy: 1 },  // 下
        { dx: 1, dy: 0 },  // 右
        { dx: -1, dy: 0 }, // 左
        { dx: 1, dy: -1 }, // 右上
        { dx: -1, dy: -1 },// 左上
        { dx: 1, dy: 1 },  // 右下
        { dx: -1, dy: 1 }  // 左下
    ];

    nodes.forEach(node => {
        let placed = false;

        if (node.isLocalMax) {
            for (let slot of slotDirections) {
                const paddingX = 4 / k;
                const paddingY = 2 / k;

                let cx = node.geoX;
                let cy = node.geoY;

                if (slot.dx !== 0) cx += slot.dx * (node.r + node.width / 2 + paddingX + gap);
                if (slot.dy !== 0) cy += slot.dy * (node.r + node.height / 2 + paddingY + gap);

                let box = {
                    x1: cx - node.width / 2,
                    x2: cx + node.width / 2,
                    y1: cy - node.height / 2,
                    y2: cy + node.height / 2,
                    data: node.data
                };

                if (!checkOverlap(box, allocatedBoxes, k)) {
                    node.offsetX = cx - node.geoX;
                    node.offsetY = cy - node.geoY;
                    allocatedBoxes.push(box);
                    placed = true;
                    break;
                }
            }
        }

        node.visible = placed;
    });

    labels.style("visibility", d => {
        const found = nodes.find(n => n.data === d);
        return (found && found.visible) ? "visible" : "hidden";
    })
        .attr("x", d => {
            const found = nodes.find(n => n.data === d);
            return found ? found.offsetX : 0;
        })
        .attr("y", d => {
            const found = nodes.find(n => n.data === d);
            return found ? found.offsetY : 0;
        });
}

function checkOverlap(box, allocatedBoxes, k) {
    const paddingX = 4 / k;
    const paddingY = 2 / k;

    for (let b of allocatedBoxes) {
        if (!(box.x2 + paddingX < b.x1 ||
            box.x1 - paddingX > b.x2 ||
            box.y2 + paddingY < b.y1 ||
            box.y1 - paddingY > b.y2)) {
            return true;
        }
    }
    return false;
}

function drawMap(twData, stationsData) {
    if (!twData || !twData.objects) return;

    let objectsKey = Object.keys(twData.objects)[0];
    if (twData.objects["counties"]) objectsKey = "counties";
    else if (twData.objects["towns"]) objectsKey = "towns";

    if (!twData.objects[objectsKey]) return;

    const counties = topojson.feature(twData, twData.objects[objectsKey]).features;

    mainGroup.selectAll(".county")
        .data(counties)
        .enter()
        .append("path")
        .attr("class", "county")
        .attr("d", path);

    const stationGroups = mainGroup.selectAll(".station-group")
        .data(stationsData)
        .enter()
        .append("g")
        .attr("class", "station-group")
        .attr("transform", d => {
            const coords = getCoords(d);
            if (!coords) return "translate(-9999, -9999)";
            const pos = projection([coords.lon, coords.lat]);
            return `translate(${pos[0]}, ${pos[1]})`;
        })
        .on("mouseover", function (event, d) {
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            const currentBaseRadius = Math.max(0.6, base / Math.sqrt(k));

            d3.select(this).select(".station").attr("r", currentBaseRadius * 1.5);

            const name = getStationName(d);
            tooltip.style("opacity", 1)
                .html(name)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function (event, d) {
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;

            d3.select(this).select(".station").attr("r", Math.max(0.6, base / Math.sqrt(k)));
            tooltip.style("opacity", 0);
        })
        .on("click", function (event, d) {
            event.stopPropagation();
            const circleDOM = d3.select(this).select(".station").node();
            selectStationElement(circleDOM, d);
        });

    stationGroups.append("circle")
        .attr("class", "station")
        .attr("r", 4)
        .attr("cx", 0)
        .attr("cy", 0);

    stationGroups.append("text")
        .attr("class", "station-label")
        .style("opacity", 0)
        .attr("x", 0)
        .text(d => getStationName(d));
}

function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function convertMinutesToHHMM(totalMinutes) {
    const absoluteMinutes = Math.floor(totalMinutes);
    const hours = Math.floor(absoluteMinutes / 60) % 24;
    const mins = absoluteMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function getCoords(d) {
    let lat, lon;
    if (d.gps) {
        const parts = d.gps.toString().trim().split(/[\s,]+/);
        const nums = parts.map(Number).filter(n => !isNaN(n));
        lat = nums.find(n => n > 21 && n < 26);
        lon = nums.find(n => n > 119 && n < 123);
    }
    else if (d['緯度'] && d['經度']) {
        lat = parseFloat(d['緯度']);
        lon = parseFloat(d['經度']);
    }
    return (lat && lon) ? { lat, lon } : null;
}

function getStationName(d) {
    return d.stationName || d['車站中文名稱'] || d.name || "";
}

async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        try {
            globalStationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data file loading failed!");
        }

        // Cache the daily schedule file globally to handle standalone train search actions
        const dateStr = getTodayDateString();
        const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${dateStr}.json?t=${new Date().getTime()}`;
        try {
            globalScheduleData = await d3.json(targetScheduleUrl);

            if (globalStationsData && globalScheduleData) {
                const stationCounts = new Map();
                globalScheduleData.forEach(train => {
                    if (train.data && Array.isArray(train.data)) {
                        train.data.forEach(stop => {
                            if (stop.x) {
                                stationCounts.set(stop.x, (stationCounts.get(stop.x) || 0) + 1);
                            }
                        });
                    }
                });

                globalStationsData.forEach(station => {
                    const name = getStationName(station);
                    station.trainCount = stationCounts.get(name) || 0;
                });
            }
        } catch (e) {
            console.warn("Global daily schedules pre-cache failure", e);
        }

        drawMap(twData, globalStationsData);
        svg.call(zoom.transform, d3.zoomIdentity); // Trigger initial zoom event to render labels
        initUnifiedSearchAutocomplete(); // Launch unified combined search engine
        scheduleNextAutoRefresh();
    } catch (err) {
        console.error("Error configuration mapping pipeline:", err);
    }
}

function selectStationElement(circleDOM, d, targetTrainNumberToExpand = null, searchInjectedDelay = undefined) {
    if (activeStationSelection === circleDOM && !targetTrainNumberToExpand) {
        document.getElementById("close-panel-btn").click();
        return;
    }

    if (activeStationSelection) {
        const oldSelection = activeStationSelection;
        activeStationSelection = null;

        const currentTransform = d3.zoomTransform(svg.node());
        const k = currentTransform.k;

        d3.select(oldSelection).classed("active", false);
        d3.select(oldSelection.parentNode).classed("active", false);

        d3.select(oldSelection).attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }

    globalStationsData.forEach(node => node.isConnectedState = false);
    mainGroup.selectAll(".station-group").classed("connected", false);
    mainGroup.selectAll(".station").classed("connected", false);

    d3.select(circleDOM).classed("active", true);
    d3.select(circleDOM.parentNode).classed("active", true);

    activeStationSelection = circleDOM;

    const currentTransform = d3.zoomTransform(svg.node());
    const k = currentTransform.k;
    d3.select(circleDOM).attr("r", Math.max(0.6, 4 / Math.sqrt(k)));

    const stationCode = d.stationCode || d['車站代碼'] || d.id || "";
    const stationName = getStationName(d);
    const stationAddrTw = d.stationAddrTw || d['站址'] || d.address || "N/A";

    const cwTarget = d.CW || "未知";
    const ccwTarget = d.CCW || "未知";

    showStationInfoPanel(stationCode, stationName, stationAddrTw, cwTarget, ccwTarget, targetTrainNumberToExpand, searchInjectedDelay);

    if (k > 8.0) updateLabelForceSimulation(k);

    const coords = getCoords(d);
    if (coords) {
        const projectedCoords = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(12).translate(-projectedCoords[0], -projectedCoords[1]));
    }
}

function getLatestTDXUrl(minuteOffset = 0) {
    const now = new Date();
    if (minuteOffset > 0) {
        now.setMinutes(now.getMinutes() - minuteOffset);
    }

    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const rawMinutes = now.getMinutes();
    const roundedMinutes = Math.floor(rawMinutes / 5) * 5;
    const minutes = String(roundedMinutes).padStart(2, '0');

    const datetimeStr = `${month}${date}${hours}${minutes}`;
    return `https://raw.githubusercontent.com/4960fh7/TDX_Fetch/main/data/data_${datetimeStr}.json?t=${now.getTime()}`;
}

function scheduleNextAutoRefresh() {
    const now = new Date();
    const currentMinutes = now.getMinutes();
    let targetMinute = Math.floor(currentMinutes / 5) * 5 + 1;
    if (currentMinutes >= targetMinute) targetMinute += 5;

    const targetTime = new Date(now);
    targetTime.setMinutes(targetMinute);
    targetTime.setSeconds(0);
    targetTime.setMilliseconds(0);

    const timeoutMs = targetTime.getTime() - now.getTime();

    setTimeout(async () => {
        if (currentActiveStationCode) {
            await showStationInfoPanel(currentActiveStationCode, currentActiveStationName, currentActiveStationAddress, currentActiveStationCW, currentActiveStationCCW);
        }
        scheduleNextAutoRefresh();
    }, timeoutMs);
}

function getTrainStatusBadge(train, rawLiveBoardInfo, currentMinutesMidnight) {
    const delayMinutes = (train.delay !== undefined && !isNaN(train.delay)) ? parseInt(train.delay, 10) : 0;

    const firstStopMinutes = train.data && train.data.length > 0 ? train.data[0].y : train.calculatedDepMinutes;
    let lastStopMinutes = train.data && train.data.length > 0 ? train.data[train.data.length - 1].y : train.calculatedDepMinutes;

    if (lastStopMinutes < firstStopMinutes) {
        lastStopMinutes += 1440; // Unroll midnight crossing
    }

    let currentMins = currentMinutesMidnight;

    // If the time is early morning, and the train starts late night, we are likely observing it post-midnight
    if (currentMins < firstStopMinutes && currentMins < 4 * 60 && firstStopMinutes > 20 * 60) {
        currentMins += 1440;
    }

    const isBeforeDeparture = currentMins < firstStopMinutes;
    const isAfterArrival = currentMins > (lastStopMinutes + delayMinutes);

    if (isBeforeDeparture) {
        return { delayBadgeHTML: `<span class="delay-badge delay-status">未發車</span>`, isActivelyInService: false };
    }

    if (isAfterArrival) {
        return { delayBadgeHTML: `<span class="delay-badge delay-status">已收班</span>`, isActivelyInService: false };
    }

    // It is actively running
    if (train.delay !== undefined) {
        if (train.delay === 0) {
            return { delayBadgeHTML: `<span class="delay-badge delay-ontime">準點</span>`, isActivelyInService: true };
        } else {
            return { delayBadgeHTML: `<span class="delay-badge delay-late">晚 ${train.delay} 分</span>`, isActivelyInService: true };
        }
    }

    // Fallback
    return { delayBadgeHTML: `<span class="delay-badge delay-unknown">未知</span>`, isActivelyInService: true };
}

async function showStationInfoPanel(code, name, address, cwTarget, ccwTarget, targetTrainNumberToExpand = null, searchInjectedDelay = undefined) {
    currentActiveStationCode = code;
    currentActiveStationName = name;
    currentActiveStationAddress = address;
    currentActiveStationCW = cwTarget;
    currentActiveStationCCW = ccwTarget;

    const appContainer = document.getElementById("app-container");
    if (targetTrainNumberToExpand && window.innerWidth <= 768) {
        appContainer.classList.remove("multi-split-mode");
    }
    appContainer.classList.add("split-mode");

    document.getElementById("station-details").innerHTML = window.innerWidth <= 768 ? `<h2>${name}</h2>` : `
        <h2>${name}</h2>
        <p><strong>車站代碼：</strong> ${code}</p>
        <p><strong>地  址：</strong> ${address}</p>
    `;

    const ccwIndicatorElement = document.querySelector(".dir-indicator.ccw-ind");
    const cwIndicatorElement = document.querySelector(".dir-indicator.cw-ind");
    const dir_break = window.innerWidth <= 768 ? "<br>" : " ";
    if (ccwIndicatorElement) ccwIndicatorElement.innerHTML = `逆行${dir_break}往 ${ccwTarget}`;
    if (cwIndicatorElement) cwIndicatorElement.innerHTML = `順行${dir_break}往 ${cwTarget}`;

    const trainWrapper = document.getElementById("unified-train-wrapper");
    if (trainWrapper) {
        trainWrapper.style.height = window.innerWidth <= 768 ? "calc(100vh - 320px)" : "75%";
    }

    const unifiedListContainer = document.getElementById("unified-train-list");
    unifiedListContainer.innerHTML = `<p class="placeholder-text">載入列車動態中...</p>`;

    const dateStr = getTodayDateString();
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${dateStr}.json?t=${new Date().getTime()}`;

    let liveBoardData = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        let currentOffset = attempts * 5;
        let liveBoardUrl = getLatestTDXUrl(currentOffset);

        try {
            liveBoardData = await d3.json(liveBoardUrl);
            if (liveBoardData) {
                console.log(`Successfully fetched real-time logs with offset -${currentOffset}m`);
                break;
            }
        } catch (err) {
            console.warn(`Data file not found (404) for offset -${currentOffset}m. Retrying older packet...`);
            attempts++;
        }
    }

    try {
        const scheduleData = await d3.json(targetScheduleUrl);

        let updateBadge = document.getElementById("live-data-update-time-badge");
        if (!updateBadge) {
            updateBadge = document.createElement("div");
            updateBadge.id = "live-data-update-time-badge";
            updateBadge.style.cssText = "float: right; margin-right: 10px; background: #162238; border: 1px solid #00f0ff; color: #00f0ff; padding: 6px 14px; border-radius: 2px; font-size: 11px; font-weight: bold; text-transform: uppercase;";
            const closeBtn = document.getElementById("close-panel-btn");
            closeBtn.innerHTML = window.innerWidth <= 768 ? `&times;` : `&times; 關閉`;
            closeBtn.parentNode.insertBefore(updateBadge, closeBtn);
        }

        if (liveBoardData && liveBoardData.UpdateTime) {
            const rawTimeStr = liveBoardData.UpdateTime.split("T")[1] || "";
            const formattedLiveTime = rawTimeStr.substring(0, 5) || "--:--";
            updateBadge.innerHTML = `最後更新：${formattedLiveTime}`;
            updateBadge.style.display = "block";
        } else {
            updateBadge.innerHTML = `最後更新：離線`;
            updateBadge.style.display = "block";
        }

        const delayMap = new Map();
        if (liveBoardData && Array.isArray(liveBoardData.TrainLiveBoards)) {
            liveBoardData.TrainLiveBoards.forEach(board => {
                delayMap.set(String(board.TrainNo), board.DelayTime);
            });
        }

        // If the query was triggered via a global search item, enforce synchronization mapping overrides
        if (targetTrainNumberToExpand && searchInjectedDelay !== undefined) {
            delayMap.set(String(targetTrainNumberToExpand), searchInjectedDelay);
        }

        renderUnifiedPassingTrains(scheduleData, name, unifiedListContainer, delayMap, liveBoardData, targetTrainNumberToExpand);
    } catch (error) {
        console.error(error);
        unifiedListContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">網站整修中，目前無法載入...</p>`;
    }
}

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
    return `${train} ${numKey}`;
}

function renderUnifiedPassingTrains(trainsList, targetStationName, listContainer, delayMap, liveBoardData, targetTrainNumberToExpand = null) {
    if (!Array.isArray(trainsList)) return;

    const connectedStationNames = new Set();
    const combinedSortedTrains = [];
    const now = new Date();

    let currentHours = now.getHours();
    let currentMins = now.getMinutes();

    if (currentHours < 4) {
        currentHours += 24;
    }
    const currentMinutesMidnight = currentHours * 60 + currentMins;

    trainsList.forEach(train => {
        const routeStops = train.data || [];
        const matchingStops = routeStops.filter(stop => stop.x === targetStationName);

        if (matchingStops.length > 0) {
            const depStop = matchingStops[matchingStops.length - 1];
            const departureMinutes = depStop.y;
            const trainNumber = train.number || "N/A";
            let delay = delayMap ? delayMap.get(String(trainNumber)) : undefined;
            let delayMinutesValue = (delay !== undefined && !isNaN(delay)) ? parseInt(delay, 10) : 0;
            const sortedSortingMinutes = departureMinutes + delayMinutesValue;

            const trainData = {
                ...train,
                calculatedDepMinutes: departureMinutes,
                sortingMinutes: sortedSortingMinutes,
                formattedTime: convertMinutesToHHMM(departureMinutes),
                formattedDelayedTime: convertMinutesToHHMM(sortedSortingMinutes),
                delay: delayMinutesValue
            };

            routeStops.forEach(stop => {
                if (stop.x && stop.x !== targetStationName) connectedStationNames.add(stop.x);
            });
            combinedSortedTrains.push(trainData);
        }
    });

    mainGroup.selectAll(".station-group")
        .filter(function (d) {
            const name = getStationName(d);
            const isConnected = connectedStationNames.has(name) && d3.select(this).select(".station").node() !== activeStationSelection;
            if (isConnected) d.isConnectedState = true;
            return isConnected;
        })
        .classed("connected", true);

    mainGroup.selectAll(".station")
        .filter(function (d) {
            const name = getStationName(d);
            return connectedStationNames.has(name) && this !== activeStationSelection;
        })
        .classed("connected", true);

    if (combinedSortedTrains.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text">No active schedules today.</p>`;
        return;
    }

    combinedSortedTrains.sort((a, b) => a.sortingMinutes - b.sortingMinutes);
    listContainer.innerHTML = "";

    let upcomingTrainDOMElement = null;
    let explicitTargetCardDOMElement = null;

    combinedSortedTrains.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";
        card.setAttribute("data-train-number", String(train.number));

        const trainType = train.train || "N/A";
        const trainNumber = train.number || "N/A";
        const trainNumberInt = parseInt(trainNumber, 10);
        const isEven = (!isNaN(trainNumberInt) && trainNumberInt % 2 === 0);
        const spacerCard = document.createElement("div");

        if (isEven) {
            card.classList.add("side-right");
            spacerCard.className = "train-card-spacer side-left";
        } else {
            card.classList.add("side-left");
            spacerCard.className = "train-card-spacer side-right";
        }

        const neonColor = colorPalette[trainType] || "#64748b";
        card.style.borderLeftColor = neonColor;
        card.style.boxShadow = `0 0 10px rgba(${hexToRgb(neonColor)}, 0.12)`;

        const infoObj = train.info || {};
        const viaLine = infoObj.via || "-";
        const rawEndStr = infoObj.end || "";
        const endStationTrimmed = rawEndStr.length > 6 ? rawEndStr.substring(6) : rawEndStr;
        const viaSegment = (viaLine !== "-") ? `經${viaLine} ` : "";
        const routeSubtitleText = `${viaSegment}往 ${endStationTrimmed}`;

        const rawLiveBoardInfo = liveBoardData?.TrainLiveBoards?.find(b => String(b.TrainNo) === String(trainNumber));
        const badgeInfo = getTrainStatusBadge(train, rawLiveBoardInfo, currentMinutesMidnight);
        const delayBadgeHTML = badgeInfo.delayBadgeHTML;

        let timeDisplayHTML = (train.delay !== undefined && train.delay > 0)
            ? `<span class="scheduled-time-strike">${train.formattedTime}</span><strong style="color: ${neonColor}">${train.formattedDelayedTime}</strong>`
            : `<strong style="color: ${neonColor}">${train.formattedTime}</strong>`;

        card.innerHTML = `
            <div class="train-header" style="display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div style="font-size: 14px;">${timeDisplayHTML}</div>
                    ${delayBadgeHTML}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <strong style="color: ${neonColor}; font-weight: bold; font-size: 13px;">${getTrainTypeName(trainType, trainNumber)}</strong>
                    <span class="train-sub-title" style="margin-top: 0; text-align: right;">${routeSubtitleText}</span>
                </div>
            </div>
        `;

        card.querySelector(".train-header").addEventListener("click", () => {
            const appContainer = document.getElementById("app-container");
            const isCurrentlyActive = card.classList.contains("expanded");
            const isSchedulePanelOpen = appContainer.classList.contains("multi-split-mode");

            listContainer.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));

            if (isCurrentlyActive && isSchedulePanelOpen) {
                appContainer.classList.remove("multi-split-mode");
            } else {
                card.classList.add("expanded");
                appContainer.classList.add("multi-split-mode");
                renderSchedulePanelContent(train, targetStationName, neonColor, rawLiveBoardInfo);
            }
        });

        if (isEven) {
            listContainer.appendChild(spacerCard);
            listContainer.appendChild(card);
        } else {
            listContainer.appendChild(card);
            listContainer.appendChild(spacerCard);
        }

        if (!upcomingTrainDOMElement && train.sortingMinutes >= currentMinutesMidnight) {
            upcomingTrainDOMElement = card;
        }

        if (targetTrainNumberToExpand && String(trainNumber) === String(targetTrainNumberToExpand)) {
            explicitTargetCardDOMElement = card;
        }
    });

    if (explicitTargetCardDOMElement) {
        const appContainer = document.getElementById("app-container");
        if (window.innerWidth > 768) {
            appContainer.classList.add("multi-split-mode");
        }

        requestAnimationFrame(() => {
            setTimeout(() => {
                const headerEl = explicitTargetCardDOMElement.querySelector(".train-header");
                if (headerEl) {
                    listContainer.querySelectorAll(".train-card").forEach(c => {
                        if (c !== explicitTargetCardDOMElement) c.classList.remove("expanded");
                    });

                    if (window.innerWidth > 768) {
                        explicitTargetCardDOMElement.classList.add("expanded");
                        const matchedTrainObj = combinedSortedTrains.find(t => String(t.number) === String(targetTrainNumberToExpand));
                        if (matchedTrainObj) {
                            const neonColor = colorPalette[matchedTrainObj.train] || "#64748b";
                            const explicitLiveBoard = liveBoardData?.TrainLiveBoards?.find(b => String(b.TrainNo) === String(targetTrainNumberToExpand));
                            renderSchedulePanelContent(matchedTrainObj, targetStationName, neonColor, explicitLiveBoard);
                        }
                    } else {
                        explicitTargetCardDOMElement.classList.add("expanded");
                    }
                }

                listContainer.scrollTo({
                    top: explicitTargetCardDOMElement.offsetTop - listContainer.offsetTop - 10,
                    behavior: 'smooth'
                });
            }, 150);
        });
    } else {
        if (!upcomingTrainDOMElement && listContainer.firstChild) {
            upcomingTrainDOMElement = listContainer.querySelector(".train-card");
        }

        if (upcomingTrainDOMElement) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    listContainer.scrollTo({
                        top: upcomingTrainDOMElement.offsetTop - listContainer.offsetTop - 10,
                        behavior: 'smooth'
                    });
                }, 100);
            });
        }
    }
}

function renderSchedulePanelContent(train, targetStationName, neonColor, rawLiveBoardInfo) {
    const trainType = train.train || "N/A";
    const trainNumber = train.number || "N/A";
    const infoObj = train.info || {};
    const viaLine = infoObj.via || "-";

    let titleText = getTrainTypeName(trainType, trainNumber);
    if (viaLine !== "-") {
        titleText += ` (${viaLine.replace(/線/g, '')})`;
    }

    const now = new Date();
    const currentMinutesMidnight = now.getHours() * 60 + now.getMinutes();
    const badgeInfo = getTrainStatusBadge(train, rawLiveBoardInfo, currentMinutesMidnight);

    document.getElementById("schedule-train-title").innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="color: ${neonColor}">${titleText}</div>
            ${badgeInfo.delayBadgeHTML}
        </div>
    `;

    let currentPositionHTML = (badgeInfo.isActivelyInService && rawLiveBoardInfo?.StationName?.Zh_tw)
        ? `<div style="font-size: 13px; color: #00ffaa; margin-top: 6px; font-weight: bold;">目前位置：${rawLiveBoardInfo.StationName.Zh_tw}</div>`
        : "";

    const noteText = infoObj.note || "無";
    let noteHTML = `備註：${noteText}`;

    if (noteText.length > 15) {
        const shortNote = noteText.substring(0, 15);
        noteHTML = `
            <span class="note-collapsed">備註：${shortNote}<span style="color: #00f0ff;">...更多</span></span>
            <span class="note-expanded" style="display: none;">備註：${noteText}</span>
        `;
    }

    const routeContainer = document.getElementById("schedule-train-route");
    routeContainer.innerHTML = `
        <div style="font-size: 15px; margin-top: 4px;">${infoObj.start || "N/A"} → ${infoObj.end || "N/A"}</div>
        ${currentPositionHTML}
        <div id="schedule-note-container" style="color: #64748b; font-size: 12px; margin-top: 6px; ${noteText.length > 15 ? 'cursor: pointer;' : ''}">${noteHTML}</div>
    `;

    if (noteText.length > 15) {
        const noteContainer = document.getElementById("schedule-note-container");
        const collapsedSpan = noteContainer.querySelector(".note-collapsed");
        const expandedSpan = noteContainer.querySelector(".note-expanded");

        noteContainer.addEventListener("click", () => {
            if (collapsedSpan.style.display === "none") {
                collapsedSpan.style.display = "inline";
                expandedSpan.style.display = "none";
            } else {
                collapsedSpan.style.display = "none";
                expandedSpan.style.display = "inline";
            }
        });
    }

    const stopsContainer = document.getElementById("schedule-stops-container");
    stopsContainer.innerHTML = "";

    const rawStops = train.data || [];
    const groupedStops = [];

    for (let i = 0; i < rawStops.length; i++) {
        const entry = rawStops[i];
        if (!entry.x) continue;

        if (groupedStops.length > 0 && groupedStops[groupedStops.length - 1].stationName === entry.x) {
            groupedStops[groupedStops.length - 1].depMinutes = entry.y;
        } else {
            groupedStops.push({
                stationName: entry.x,
                arrMinutes: entry.y,
                depMinutes: null
            });
        }
    }

    const delayMinutesValue = (train.delay !== undefined && !isNaN(train.delay)) ? parseInt(train.delay, 10) : 0;

    stopsContainer.innerHTML = groupedStops.map(stop => {
        const isCurrentStation = stop.stationName === targetStationName;

        let scheduledString = "";
        if (stop.arrMinutes !== null && stop.depMinutes !== null && stop.arrMinutes !== stop.depMinutes) {
            scheduledString = `${convertMinutesToHHMM(stop.arrMinutes)} / ${convertMinutesToHHMM(stop.depMinutes)}`;
        } else {
            const singleTime = stop.arrMinutes !== null ? stop.arrMinutes : stop.depMinutes;
            scheduledString = convertMinutesToHHMM(singleTime);
        }

        const stringColor = isCurrentStation ? `style="color: ${neonColor}"` : "";

        let timeDisplayHTML = "";
        if (delayMinutesValue > 0) {
            let delayedString = "";
            if (stop.arrMinutes !== null && stop.depMinutes !== null && stop.arrMinutes !== stop.depMinutes) {
                delayedString = `${convertMinutesToHHMM(stop.arrMinutes + delayMinutesValue)} / ${convertMinutesToHHMM(stop.depMinutes + delayMinutesValue)}`;
            } else {
                const singleTime = stop.arrMinutes !== null ? stop.arrMinutes : stop.depMinutes;
                delayedString = convertMinutesToHHMM(singleTime + delayMinutesValue);
            }
            timeDisplayHTML = `<strong ${stringColor}>${delayedString}</strong>`;
        } else {
            timeDisplayHTML = `<strong ${stringColor}>${scheduledString}</strong>`;
        }

        const highlightStyle = isCurrentStation ? `background: rgba(${hexToRgb(neonColor)}, 0.15); border-left: 2px solid ${neonColor}; padding-left: 6px; font-weight: bold;` : "";
        const activeClassAttr = isCurrentStation ? `class="current-selected-stop-row"` : "";

        return `
            <div ${activeClassAttr} 
                 class="schedule-stop-item-row"
                 data-station-click-name="${stop.stationName}"
                 data-associated-train="${trainNumber}"
                 style="display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; margin-bottom: 3px; cursor: pointer; ${highlightStyle}">
                <span class="stop-name-text" style="transition: color 0.2s;">${stop.stationName}</span>
                <span>${timeDisplayHTML}</span>
            </div>
        `;
    }).join("");

    stopsContainer.querySelectorAll(".schedule-stop-item-row").forEach(row => {
        row.addEventListener("click", (e) => {
            const clickedName = row.getAttribute("data-station-click-name");
            const currentTrainNum = row.getAttribute("data-associated-train");
            if (!clickedName) return;

            const d3Circles = mainGroup.selectAll(".station");
            let matchedData = null;
            let matchedNode = null;

            d3Circles.each(function (d) {
                if (getStationName(d) === clickedName) {
                    matchedData = d;
                    matchedNode = this;
                }
            });

            if (matchedNode && matchedData) {
                if (window.innerWidth <= 768) {
                    const appContainer = document.getElementById("app-container");
                    appContainer.classList.remove("multi-split-mode");
                    appContainer.classList.add("split-mode");
                    document.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));
                }
                selectStationElement(matchedNode, matchedData, currentTrainNum, delayMinutesValue);
            }
        });
    });

    const targetRow = stopsContainer.querySelector(".current-selected-stop-row");
    if (targetRow) {
        setTimeout(() => {
            stopsContainer.scrollTo({
                top: targetRow.offsetTop - stopsContainer.offsetTop - 20,
                behavior: "smooth"
            });
        }, 60);
    }
}

function hexToRgb(hex) {
    let c = hex.substring(1);
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

// Unified Search Autocomplete for Stations and Trains
function initUnifiedSearchAutocomplete() {
    const searchInput = document.getElementById("unified-search-input");
    const suggestionsDropdown = document.getElementById("unified-suggestions");

    searchInput.addEventListener("input", function () {
        const rawValue = this.value.trim();
        const normalizedValue = rawValue.replace(/台/g, '臺').toLowerCase();
        suggestionsDropdown.innerHTML = "";

        if (!rawValue) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        const stationMatches = globalStationsData.filter(station => {
            const name = getStationName(station).toLowerCase();
            return name.includes(normalizedValue);
        });

        let trainMatches = [];
        if (globalScheduleData) {
            trainMatches = globalScheduleData.filter(t =>
                String(t.number).includes(normalizedValue)
            );

            trainMatches.sort((a, b) => {
                return parseInt(a.number, 10) - parseInt(b.number, 10);
            });
        }

        if (stationMatches.length === 0 && trainMatches.length === 0) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        if (stationMatches.length > 0) {
            const catTitle = document.createElement("div");
            catTitle.className = "suggestion-category-title";
            catTitle.innerText = "車站站名";
            suggestionsDropdown.appendChild(catTitle);

            stationMatches.forEach(station => {
                const name = getStationName(station);
                const item = document.createElement("div");
                item.className = "suggestion-item";
                item.textContent = name;

                item.addEventListener("click", () => {
                    searchInput.value = "";
                    suggestionsDropdown.style.display = "none";
                    triggerSelectionByStationName(name);
                });
                suggestionsDropdown.appendChild(item);
            });
        }

        if (trainMatches.length > 0) {
            const catTitle = document.createElement("div");
            catTitle.className = "suggestion-category-title";
            catTitle.innerText = "車次班次";
            suggestionsDropdown.appendChild(catTitle);

            trainMatches.forEach(train => {
                const trainType = train.train || "";
                const trainNum = train.number || "";
                const startNode = train.info?.start || "";
                const endNode = train.info?.end || "";

                const item = document.createElement("div");
                item.className = "suggestion-item";
                item.innerHTML = `<span style="color:${colorPalette[trainType]}; font-weight:bold;">${getTrainTypeName(trainType, trainNum)}</span> <span style="font-size:12px; color:#a1a1aa;">(${startNode} → ${endNode})</span>`;

                item.addEventListener("click", () => {
                    searchInput.value = "";
                    suggestionsDropdown.style.display = "none";
                    triggerSelectionByTrainNumber(trainNum);
                });
                suggestionsDropdown.appendChild(item);
            });
        }

        suggestionsDropdown.style.display = "block";
    });

    searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            const val = this.value.trim().replace(/台/g, '臺');
            if (!val) return;

            if (/^\d+$/.test(val)) {
                triggerSelectionByTrainNumber(val);
            } else {
                triggerSelectionByStationName(val);
            }
            this.value = "";
            suggestionsDropdown.style.display = "none";
        }
    });

    document.addEventListener("click", (e) => {
        if (e.target !== searchInput) suggestionsDropdown.style.display = "none";
    });
}

function triggerSelectionByStationName(targetName) {
    const d3Circles = mainGroup.selectAll(".station");
    let matchedData = null;
    let matchedNode = null;

    d3Circles.each(function (d) {
        if (getStationName(d).toLowerCase() === targetName.toLowerCase()) {
            matchedData = d;
            matchedNode = this;
        }
    });

    if (matchedNode && matchedData) {
        selectStationElement(matchedNode, matchedData);
    } else {
        alert("找不到此車站，請檢查名稱是否拼寫正確。");
    }
}

async function triggerSelectionByTrainNumber(trainNumber) {
    if (!globalScheduleData || globalScheduleData.length === 0) {
        alert("班次資料尚在準備中，請稍候再試。");
        return;
    }

    const matchedTrain = globalScheduleData.find(t => String(t.number) === String(trainNumber));
    if (!matchedTrain) {
        alert(`找不到車次編號: ${trainNumber}`);
        return;
    }

    const rawStops = matchedTrain.data || [];
    if (rawStops.length === 0) return;

    const groupedStops = [];
    rawStops.forEach(entry => {
        if (!entry.x) return;
        if (groupedStops.length > 0 && groupedStops[groupedStops.length - 1].stationName === entry.x) {
            groupedStops[groupedStops.length - 1].depMinutes = entry.y;
        } else {
            groupedStops.push({
                stationName: entry.x,
                arrMinutes: entry.y,
                depMinutes: entry.y
            });
        }
    });

    if (groupedStops.length === 0) return;

    let delayMinutesValue = 0;
    try {
        let liveBoardData = null;
        for (let attempts = 0; attempts < 3; attempts++) {
            try {
                liveBoardData = await d3.json(getLatestTDXUrl(attempts * 5));
                if (liveBoardData) break;
            } catch (e) { }
        }
        if (liveBoardData && Array.isArray(liveBoardData.TrainLiveBoards)) {
            const liveInfo = liveBoardData.TrainLiveBoards.find(b => String(b.TrainNo) === String(trainNumber));
            if (liveInfo && liveInfo.DelayTime !== undefined && !isNaN(liveInfo.DelayTime)) {
                delayMinutesValue = parseInt(liveInfo.DelayTime, 10);
            }
        }
    } catch (e) {
        console.warn("Live board fetch failure during train routing selection", e);
    }

    // Explicitly bind the delay to the matchedTrain object before calling UI triggers
    matchedTrain.delay = delayMinutesValue;

    const now = new Date();
    let currentHours = now.getHours();
    if (currentHours < 4) currentHours += 24;
    const currentMinutesMidnight = currentHours * 60 + now.getMinutes();

    const firstStop = groupedStops[0];
    const lastStop = groupedStops[groupedStops.length - 1];

    let targetStationName = "";

    if (currentMinutesMidnight < (firstStop.arrMinutes + delayMinutesValue)) {
        targetStationName = firstStop.stationName;
    } else if (currentMinutesMidnight > (lastStop.depMinutes + delayMinutesValue)) {
        targetStationName = lastStop.stationName;
    } else {
        const nextUpcomingStop = groupedStops.find(stop =>
            (stop.depMinutes + delayMinutesValue) >= currentMinutesMidnight
        );
        targetStationName = nextUpcomingStop ? nextUpcomingStop.stationName : lastStop.stationName;
    }

    if (targetStationName) {
        if (targetStationName === "臺北_環島") targetStationName = "臺北";
        const d3Circles = mainGroup.selectAll(".station");
        let matchedNodeData = null;
        let matchedDOMNode = null;

        d3Circles.each(function (d) {
            if (getStationName(d) === targetStationName) {
                matchedNodeData = d;
                matchedDOMNode = this;
            }
        });

        if (matchedDOMNode && matchedNodeData) {
            selectStationElement(matchedDOMNode, matchedNodeData, String(matchedTrain.number), delayMinutesValue);
        } else {
            alert(`找不到對應的車站節點: ${targetStationName}`);
        }
    }
}

document.getElementById("close-schedule-btn").addEventListener("click", () => {
    const appContainer = document.getElementById("app-container");
    appContainer.classList.remove("multi-split-mode");
    appContainer.classList.add("split-mode");
    document.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));
});

document.getElementById("close-panel-btn").addEventListener("click", () => {
    const appContainer = document.getElementById("app-container");
    appContainer.classList.remove("split-mode");
    appContainer.classList.remove("multi-split-mode");
    document.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));

    currentActiveStationCode = null;
    currentActiveStationName = null;
    currentActiveStationAddress = null;
    currentActiveStationCW = null;
    currentActiveStationCCW = null;

    const updateBadge = document.getElementById("live-data-update-time-badge");
    if (updateBadge) updateBadge.style.display = "none";

    if (activeStationSelection) {
        const oldSelection = activeStationSelection;
        activeStationSelection = null;

        const currentTransform = d3.zoomTransform(svg.node());
        const k = currentTransform.k;

        d3.select(oldSelection).classed("active", false);
        d3.select(oldSelection.parentNode).classed("active", false);

        d3.select(oldSelection).attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }

    globalStationsData.forEach(node => node.isConnectedState = false);
    mainGroup.selectAll(".station-group").classed("connected", false);
    mainGroup.selectAll(".station").classed("connected", false);

    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
});

document.addEventListener("DOMContentLoaded", () => {
    // 1. Initialize CSS variables from memory if available
    const root = document.documentElement;
    const savedSplitInfoWidth = localStorage.getItem('splitInfoWidth');
    const savedScheduleWidth = localStorage.getItem('scheduleWidth');

    if (savedSplitInfoWidth) root.style.setProperty('--split-info-width', savedSplitInfoWidth);
    if (savedScheduleWidth) root.style.setProperty('--schedule-width', savedScheduleWidth);

    function checkWidthAdjustments() {
        const resetBtn = document.getElementById('reset-widths-btn');
        if (!resetBtn) return;

        if (window.innerWidth <= 768) {
            resetBtn.style.display = 'none';
            return;
        }

        const splitWidthStr = root.style.getPropertyValue('--split-info-width');
        const scheduleWidthStr = root.style.getPropertyValue('--schedule-width');

        const isCustomized = (splitWidthStr && splitWidthStr !== '60vw') ||
            (scheduleWidthStr && scheduleWidthStr !== '20vw');

        resetBtn.style.display = isCustomized ? 'block' : 'none';
    }

    const resetBtn = document.getElementById('reset-widths-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            root.style.setProperty('--split-info-width', '60vw');
            root.style.setProperty('--schedule-width', '20vw');
            localStorage.removeItem('splitInfoWidth');
            localStorage.removeItem('scheduleWidth');
            checkWidthAdjustments();
        });
    }

    window.addEventListener('resize', checkWidthAdjustments);
    checkWidthAdjustments();

    // 2. Create Resizers
    const infoPanel = document.getElementById('info-panel');
    const schedulePanel = document.getElementById('schedule-panel');
    const appContainer = document.getElementById('app-container');

    const infoResizer = document.createElement('div');
    infoResizer.className = 'panel-resizer';
    infoPanel.appendChild(infoResizer);

    const scheduleResizer = document.createElement('div');
    scheduleResizer.className = 'panel-resizer';
    schedulePanel.appendChild(scheduleResizer);

    // 3. Drag Logic
    let isDraggingInfo = false;
    let isDraggingSchedule = false;

    infoResizer.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 768) return; // Disable on mobile
        isDraggingInfo = true;
        infoResizer.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';
    });

    scheduleResizer.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 768) return; // Disable on mobile
        isDraggingSchedule = true;
        scheduleResizer.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingInfo && !isDraggingSchedule) return;

        const containerWidth = window.innerWidth;

        if (isDraggingInfo) {
            // Dragging the info resizer changes the total width allocated to side panels
            let newWidth = containerWidth - e.clientX;

            const isMulti = appContainer.classList.contains('multi-split-mode');
            const scheduleWidthVwStr = root.style.getPropertyValue('--schedule-width') || '20vw';
            const scheduleWidthPx = parseFloat(scheduleWidthVwStr) / 100 * containerWidth;

            // Enforce limits: At least 30vw (or schedule width + 15vw if open), max 80vw
            const minWidth = isMulti ? scheduleWidthPx + (containerWidth * 0.15) : containerWidth * 0.3;
            const maxWidth = containerWidth * 0.8;
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            const newWidthVw = (newWidth / containerWidth) * 100 + 'vw';
            root.style.setProperty('--split-info-width', newWidthVw);

        } else if (isDraggingSchedule) {
            // Dragging the schedule resizer changes only the schedule panel width
            let newWidth = containerWidth - e.clientX;

            // It cannot exceed the total side panel width minus a 15vw buffer for the info panel
            const totalSideWidthVwStr = root.style.getPropertyValue('--split-info-width') || '60vw';
            const totalSideWidthPx = parseFloat(totalSideWidthVwStr) / 100 * containerWidth;

            const minWidth = containerWidth * 0.15;
            const maxWidth = totalSideWidthPx - (containerWidth * 0.15);
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            const newWidthVw = (newWidth / containerWidth) * 100 + 'vw';
            root.style.setProperty('--schedule-width', newWidthVw);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingInfo || isDraggingSchedule) {
            isDraggingInfo = false;
            isDraggingSchedule = false;
            infoResizer.classList.remove('dragging');
            scheduleResizer.classList.remove('dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';

            // Save adjustments to localStorage
            localStorage.setItem('splitInfoWidth', root.style.getPropertyValue('--split-info-width'));
            localStorage.setItem('scheduleWidth', root.style.getPropertyValue('--schedule-width'));

            checkWidthAdjustments();
        }
    });
});

loadData();