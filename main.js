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
    "自強": "#5ad362",    
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

        // 當縮放比例大於 8 時顯示標籤並重新計算防重疊布局
        if (k > 8.0) {
            mainGroup.selectAll(".station-label").style("opacity", 1);
            updateLabelForceSimulation(k);
        } else {
            mainGroup.selectAll(".station-label").style("opacity", 0);
        }
    });

svg.call(zoom);

// 關鍵修復 3 & 4：高性能靜態防重疊邊界判定算法（取代會造成卡頓的物理模擬引擎）
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

    // 1. 初始化所有標籤至預設的上方位置
    labels.attr("y", d => {
        const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
        const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;
        return -r - (4 / k);
    }).attr("x", 0).style("visibility", "visible");

    // 2. 獲取當前視角下各標籤的絕對坐標虛擬包圍盒 (Bounding Box)
    const allocatedBoxes = [];

    // 將重要車站（選取中、連線中）排序在前面優先放置
    const nodes = globalStationsData.map(d => {
        const coords = getCoords(d);
        if (!coords) return null;
        const pos = projection([coords.lon, coords.lat]);
        
        // 計算預設擺放坐標
        const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
        const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;
        const labelYOffset = -r - (4 / k);

        const name = getStationName(d);
        // 基於字數估算寬度與高度
        const estWidth = name.length * fontSize * 1.1;
        const estHeight = fontSize * 1.2;

        return {
            data: d,
            geoX: pos[0],
            geoY: pos[1],
            offsetX: 0,
            offsetY: labelYOffset,
            width: estWidth,
            height: estHeight,
            priority: isCurrentActive ? 3 : (d.isConnectedState ? 2 : 1)
        };
    }).filter(n => n !== null);

    // 依優先級排序（重要標籤先放置，普通標籤若遇衝突則避讓或隱藏）
    nodes.sort((a, b) => b.priority - a.priority);

    // 避讓方向槽位：正上、正下、右側、左側
    const slotOffsets = [
        { x: 0, y: 1 },  // 改放下方
        { x: 1, y: 0 },  // 改放右側
        { x: -1, y: 0 }  // 改放左側
    ];

    nodes.forEach(node => {
        let currentX = node.geoX + node.offsetX;
        let currentY = node.geoY + node.offsetY;
        
        let box = {
            x1: currentX - node.width / 2,
            x2: currentX + node.width / 2,
            y1: currentY - node.height / 2,
            y2: currentY + node.height / 2,
            data: node.data
        };

        let hasOverlap = checkOverlap(box, allocatedBoxes, k);
        
        // 如果上方重疊，嘗試切換其他固定方位槽位
        if (hasOverlap) {
            for (let slot of slotOffsets) {
                const shiftDist = (fontSize * 1.2) + standardCircleRadius + (5 / k);
                let altOffsetX = slot.x * shiftDist * 1.5;
                let altOffsetY = slot.y * shiftDist;
                if (slot.x !== 0) altOffsetY = 0; // 左右對齊時垂直置中

                box.x1 = (node.geoX + altOffsetX) - node.width / 2;
                box.x2 = (node.geoX + altOffsetX) + node.width / 2;
                box.y1 = (node.geoY + altOffsetY) - node.height / 2;
                box.y2 = (node.geoY + altOffsetY) + node.height / 2;

                if (!checkOverlap(box, allocatedBoxes, k)) {
                    node.offsetX = altOffsetX;
                    node.offsetY = altOffsetY;
                    hasOverlap = false;
                    break;
                }
            }
        }

        if (!hasOverlap) {
            allocatedBoxes.push(box);
            node.visible = true;
        } else {
            // 如果所有方位都嚴重擁擠，隱藏低優先級的標籤
            node.visible = false;
        }
    });

    // 3. 將計算出的非重疊固定偏移量套用到 DOM 上
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

// 輔助函式：判斷文字盒與文字盒，或文字盒與車站圓圈是否重疊
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

    // 建立一體化的車站群組
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
        .on("mouseover", function(event, d) {
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
        .on("mouseout", function(event, d) {
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            
            d3.select(this).select(".station").attr("r", Math.max(0.6, base / Math.sqrt(k)));
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
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

// 關鍵修復 1：修復過午夜（跨日）後的自動滾動判定區間
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
        drawMap(twData, globalStationsData);
        initSearchAutocomplete();
        scheduleNextAutoRefresh();
    } catch (err) {
        console.error("Error configuration mapping pipeline:", err);
    }
}

function selectStationElement(circleDOM, d) {
    if (activeStationSelection) {
        const oldSelection = activeStationSelection;
        activeStationSelection = null;
        
        const currentTransform = d3.zoomTransform(svg.node());
        const k = currentTransform.k;
        
        d3.select(oldSelection).classed("active", false);
        d3.select(oldSelection.parentNode).classed("active", false);
        
        d3.select(oldSelection).attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }
    
    // 重設所有狀態
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

    showStationInfoPanel(stationCode, stationName, stationAddrTw, cwTarget, ccwTarget);
    
    if (k > 8.0) updateLabelForceSimulation(k);

    const coords = getCoords(d);
    if (coords) {
        const projectedCoords = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(12).translate(-projectedCoords[0], -projectedCoords[1]));
    }
}

// 核心優化：允許傳入偏移量（分鐘），以便在遇到 404 時向過去時間回溯尋找可用檔案
function getLatestTDXUrl(minuteOffset = 0) {
    const now = new Date();
    // 如果有傳入偏移量，將時間減去對應的分鐘數
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

async function showStationInfoPanel(code, name, address, cwTarget, ccwTarget) {
    currentActiveStationCode = code;
    currentActiveStationName = name;
    currentActiveStationAddress = address;
    currentActiveStationCW = cwTarget;
    currentActiveStationCCW = ccwTarget;

    document.getElementById("app-container").classList.add("split-mode");

    document.getElementById("station-details").innerHTML = window.innerWidth <= 768 ? "" : `
        <h2>${name}</h2>
        <p><strong>車站代碼：</strong> ${code}</p>
        <p><strong>地　　址：</strong> ${address}</p>
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
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json?t=${new Date().getTime()}`;

    // =======================================================
    // 核心穩定度修改：自動容錯迴圈 (嘗試讀取最新、5分鐘前、10分鐘前檔案)
    // =======================================================
    let liveBoardData = null;
    let attempts = 0;
    const maxAttempts = 3; // 最多往前找 3 個週期（即 15 分鐘前）

    while (attempts < maxAttempts) {
        // 第一次嘗試 offset = 0 (最新), 第二次 offset = 5 (5分鐘前), 第三次 offset = 10 (10分鐘前)
        let currentOffset = attempts * 5; 
        let liveBoardUrl = getLatestTDXUrl(currentOffset);

        try {
            liveBoardData = await d3.json(liveBoardUrl);
            // 如果成功抓到資料，直接跳出迴圈
            if (liveBoardData) {
                console.log(`Successfully fetched real-time logs with offset -${currentOffset}m`);
                break;
            }
        } catch (err) {
            console.warn(`Data file not found (404) for offset -${currentOffset}m. Retrying older packet...`);
            attempts++;
        }
    }
    // =======================================================

    try {
        // 載入固定排班表數據（此處不再因即時資料 404 而被阻斷中斷）
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
            // 如果嘗試 3 次都 404，呈現離線模式，但不崩潰，依然正常渲染基礎時刻表
            updateBadge.innerHTML = `最後更新：離線`;
            updateBadge.style.display = "block";
        }

        const delayMap = new Map();
        if (liveBoardData && Array.isArray(liveBoardData.TrainLiveBoards)) {
            liveBoardData.TrainLiveBoards.forEach(board => {
                delayMap.set(String(board.TrainNo), board.DelayTime);
            });
        }

        renderUnifiedPassingTrains(scheduleData, name, unifiedListContainer, delayMap, liveBoardData);
    } catch (error) {
        console.error(error);
        unifiedListContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load logs.</p>`;
    }
}

function renderUnifiedPassingTrains(trainsList, targetStationName, listContainer, delayMap, liveBoardData) {
    if (!Array.isArray(trainsList)) return;

    const connectedStationNames = new Set();
    const combinedSortedTrains = [];
    const now = new Date();
    const currentMinutesMidnight = now.getHours() * 60 + now.getMinutes();

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
                delay: delay 
            };

            routeStops.forEach(stop => {
                if (stop.x && stop.x !== targetStationName) connectedStationNames.add(stop.x);
            });
            combinedSortedTrains.push(trainData);
        }
    });

    // 關鍵修復 2：標註哪些車站數據模型處於 connected 狀態，供佈局分配優先度使用
    mainGroup.selectAll(".station-group")
        .filter(function(d) {
            const name = getStationName(d);
            const isConnected = connectedStationNames.has(name) && d3.select(this).select(".station").node() !== activeStationSelection;
            if (isConnected) d.isConnectedState = true;
            return isConnected;
        })
        .classed("connected", true);

    mainGroup.selectAll(".station")
        .filter(function(d) {
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

    combinedSortedTrains.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

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

        const startText = infoObj.start || "N/A";
        const endText = rawEndStr || "N/A";
        const noteText = infoObj.note || "無";

        let delayBadgeHTML = "";
        let isActivelyInService = false;
        const rawLiveBoardInfo = liveBoardData?.TrainLiveBoards?.find(b => String(b.TrainNo) === String(trainNumber));
        
        if (train.delay !== undefined) {
            isActivelyInService = true;
            delayBadgeHTML = train.delay === 0 
                ? `<span class="delay-badge delay-ontime">準點</span>` 
                : `<span class="delay-badge delay-late">晚 ${train.delay} 分</span>`;
        } else {
            if (rawLiveBoardInfo) {
                if (rawLiveBoardInfo.TrainStationStatus === 0) delayBadgeHTML = `<span class="delay-badge delay-status">未發車</span>`;
                else if (rawLiveBoardInfo.TrainStationStatus === 2) delayBadgeHTML = `<span class="delay-badge delay-status">已收班</span>`;
                else {
                    delayBadgeHTML = `<span class="delay-badge delay-unknown">未知</span>`;
                    isActivelyInService = true;
                }
            } else {
                delayBadgeHTML = (currentMinutesMidnight > train.calculatedDepMinutes + 30)
                    ? `<span class="delay-badge delay-status">已收班</span>`
                    : `<span class="delay-badge delay-status">未發車</span>`;
            }
        }

        let timeDisplayHTML = (train.delay !== undefined && train.delay > 0)
            ? `<span class="scheduled-time-strike">${train.formattedTime}</span><strong style="color: ${neonColor}">${train.formattedDelayedTime}</strong>`
            : `<strong style="color: ${neonColor}">${train.formattedTime}</strong>`;

        let currentPositionHTML = (isActivelyInService && rawLiveBoardInfo?.StationName?.Zh_tw)
            ? `<br><span style="font-size: 11px;">目前位置：${rawLiveBoardInfo.StationName.Zh_tw}</span>`
            : "";

        card.innerHTML = `
            <div class="train-header">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div>
                        ${timeDisplayHTML}<br>
                        <strong style="color: ${neonColor}; font-weight: bold;">${trainType} ${trainNumber}</strong>
                    </div>
                    ${delayBadgeHTML}
                </div>
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details">
                ${startText} → ${endText} ${currentPositionHTML} <br>
                <span style="color: #64748b; display: inline-block; margin-top: 4px;">${noteText}</span>
            </div>
        `;

        card.querySelector(".train-header").addEventListener("click", () => {
            card.classList.toggle("expanded");
        });

        if (isEven) {
            listContainer.appendChild(spacerCard);
            listContainer.appendChild(card);
        } else {
            listContainer.appendChild(card);
            listContainer.appendChild(spacerCard);
        }

        // 關鍵修復 1修正：如果是在午夜跨日之後（如凌晨 00:05 且清單中包含跨日清晨車次），
        // 如果找不到大於當前時間的車次，預設黏著至第一班車，防止滑動失效
        if (!upcomingTrainDOMElement && train.sortingMinutes >= currentMinutesMidnight) {
            upcomingTrainDOMElement = card;
        }
    });

    // 如果所有當日車次時間都已經小於當前時間（例如深夜），則默認定位到清單第一筆
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

function hexToRgb(hex) {
    let c = hex.substring(1);
    if(c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

function initSearchAutocomplete() {
    const searchInput = document.getElementById("station-search-input");
    const suggestionsDropdown = document.getElementById("search-suggestions");

    searchInput.addEventListener("input", function() {
        const value = this.value.replace(/台/g, '臺').trim().toLowerCase();
        suggestionsDropdown.innerHTML = "";

        if (!value) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        const matches = globalStationsData.filter(station => {
            const name = getStationName(station).toLowerCase();
            return name.includes(value);
        });

        if (matches.length === 0) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        matches.forEach(station => {
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

        suggestionsDropdown.style.display = "block";
    });

    searchInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            const val = this.value.trim();
            if (val) {
                this.value = "";
                triggerSelectionByStationName(val);
                suggestionsDropdown.style.display = "none";
            }
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

    d3Circles.each(function(d) {
        if (getStationName(d).toLowerCase() === targetName.toLowerCase()) {
            matchedData = d;
            matchedNode = this;
        }
    });

    if (matchedNode && matchedData) selectStationElement(matchedNode, matchedData);
    else alert("Station not found. Please clarify spelling entries.");
}

document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
    
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

loadData();