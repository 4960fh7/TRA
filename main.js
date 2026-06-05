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

        // 當縮放比例大於 8 時顯示標籤並重新計算防重疊布局
        if (k > 8.0) {
            mainGroup.selectAll(".station-label").style("opacity", 1);
            updateLabelForceSimulation(k);
        } else {
            mainGroup.selectAll(".station-label").style("opacity", 0);
        }
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

    labels.attr("y", d => {
        const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
        const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;
        return -r - (4 / k);
    }).attr("x", 0).style("visibility", "visible");

    const allocatedBoxes = [];

    const nodes = globalStationsData.map(d => {
        const coords = getCoords(d);
        if (!coords) return null;
        const pos = projection([coords.lon, coords.lat]);
        
        const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
        const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;
        const labelYOffset = -r - (4 / k);

        const name = getStationName(d);
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

    nodes.sort((a, b) => b.priority - a.priority);

    const slotOffsets = [
        { x: 0, y: 1 },  
        { x: 1, y: 0 },  
        { x: -1, y: 0 }  
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
        
        if (hasOverlap) {
            for (let slot of slotOffsets) {
                const shiftDist = (fontSize * 1.2) + standardCircleRadius + (5 / k);
                let altOffsetX = slot.x * shiftDist * 1.5;
                let altOffsetY = slot.y * shiftDist;
                if (slot.x !== 0) altOffsetY = 0; 

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
            node.visible = false;
        }
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
    } else if (d['緯度'] && d['經度']) {
        lat = parseFloat(d['緯度']);
        lon = parseFloat(d['經度']);
    } else {
        const keys = Object.keys(d);
        const latKey = keys.find(k => k.includes("緯度"));
        const lonKey = keys.find(k => k.includes("經度"));
        if (latKey && lonKey) {
            lat = parseFloat(d[latKey]);
            lon = parseFloat(d[lonKey]);
        }
    }
    if (lat && lon) return { lat, lon };
    return null;
}

function getStationName(d) {
    return d.stationName || d['車站名稱'] || d['站名'] || d.name || "未知車站";
}

function getStationCode(d) {
    return d.stationID || d['車站代碼'] || d.code || "";
}

function getLatestTDXUrl(offsetMinutes = 0) {
    const targetTime = new Date(new Date().getTime() - (offsetMinutes * 60 * 1000));
    const yyyy = targetTime.getFullYear();
    const mm = String(targetTime.getMonth() + 1).padStart(2, '0');
    const dd = String(targetTime.getDate()).padStart(2, '0');
    const hh = String(targetTime.getHours()).padStart(2, '0');
    
    let baseMins = Math.floor(targetTime.getMinutes() / 5) * 5;
    const nn = String(baseMins).padStart(2, '0');
    
    return `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/live_data/${yyyy}${mm}${dd}_${hh}${nn}.json`;
}

async function selectStationElement(circleDOM, nodeData, targetTrainNumberToExpand = null) {
    if (activeStationSelection) {
        d3.select(activeStationSelection).classed("active", false);
        d3.select(activeStationSelection.parentNode).classed("active", false);
    }

    activeStationSelection = circleDOM;
    d3.select(circleDOM).classed("active", true);
    d3.select(circleDOM.parentNode).classed("active", true);

    currentActiveStationName = getStationName(nodeData);
    currentActiveStationCode = getStationCode(nodeData);
    currentActiveStationAddress = nodeData['地址'] || nodeData.address || "無提供地址欄位資料";
    
    currentActiveStationCW = Array.isArray(nodeData.cw) ? nodeData.cw : [];
    currentActiveStationCCW = Array.isArray(nodeData.ccw) ? nodeData.ccw : [];

    const coords = getCoords(nodeData);
    if (coords) {
        const pos = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2 - pos[0] * 5, height / 2 - pos[1] * 5).scale(5));
    }

    const appContainer = document.getElementById("app-container");
    appContainer.classList.add("split-mode");

    const currentTransform = d3.zoomTransform(svg.node());
    const k = currentTransform.k;
    d3.select(circleDOM).attr("r", Math.max(0.6, 4 / Math.sqrt(k)));

    document.getElementById("station-details").innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px;">
            <div style="font-size: 16px; font-weight: bold; color: #00f0ff; font-family:'GlowSansSCCom-Compressed', sans-serif;">
                ${currentActiveStationName} <span style="font-size:11px; color:#4ade80; border:1px solid #4ade80; padding:1px 4px; margin-left:6px; border-radius:2px;">STATION</span>
            </div>
            <div style="font-size: 10px; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width:240px;">
                ID: ${currentActiveStationCode} | ${currentActiveStationAddress}
            </div>
        </div>
    `;

    document.getElementById("unified-train-list").innerHTML = `<p class="placeholder-text">🔍 正在向太空基地調度中心同步聯絡實時動態軌道資料...</p>`;
    
    // 清除舊線段高亮狀態
    globalStationsData.forEach(node => node.isConnectedState = false);
    mainGroup.selectAll(".station-group").classed("connected", false);
    mainGroup.selectAll(".station").classed("connected", false);

    // 收集所有相關聯接車站
    const primaryConnectedNames = new Set();
    if (currentActiveStationCW) currentActiveStationCW.forEach(n => primaryConnectedNames.add(n));
    if (currentActiveStationCCW) currentActiveStationCCW.forEach(n => primaryConnectedNames.add(n));

    globalStationsData.forEach(node => {
        const checkName = getStationName(node);
        if (primaryConnectedNames.has(checkName)) {
            node.isConnectedState = true;
        }
    });

    mainGroup.selectAll(".station-group").filter(d => d.isConnectedState)
        .classed("connected", true)
        .select(".station").classed("connected", true);

    if (k > 8.0) {
        updateLabelForceSimulation(k);
    }

    // 執行即時排程撈取
    await fetchLiveBoardData(targetTrainNumberToExpand);
}

async function fetchLiveBoardData(targetTrainNumberToExpand = null) {
    let fetchedData = null;
    let successfulOffset = 0;

    for (let attempts = 0; attempts < 4; attempts++) {
        const checkUrl = getLatestTDXUrl(attempts * 5);
        try {
            fetchedData = await d3.json(checkUrl);
            if (fetchedData && Array.isArray(fetchedData.TrainLiveBoards) && fetchedData.TrainLiveBoards.length > 0) {
                successfulOffset = attempts * 5;
                break;
            }
        } catch (e) {
            console.warn(`Attempt at -${attempts * 5} mins failed to load standard TDX asset.`);
        }
    }

    if (!fetchedData || !Array.isArray(fetchedData.TrainLiveBoards)) {
        document.getElementById("unified-train-list").innerHTML = `<p class="placeholder-text" style="color:#ef4444;">❌ 無法獲取台鐵實時數據。請檢查網路或稍後再試。</p>`;
        return;
    }

    const tdxList = fetchedData.TrainLiveBoards;
    const now = new Date();
    const updateTimeStr = convertMinutesToHHMM(now.getHours() * 60 + now.getMinutes());
    
    const metaContainer = document.getElementById("info-panel-meta-container");
    let badge = document.getElementById("live-data-update-time-badge");
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "live-data-update-time-badge";
        badge.className = "live-update-badge";
        metaContainer.appendChild(badge);
    }
    badge.style.display = "block";
    badge.innerText = `LIVE -${successfulOffset}m SYNCED: ${updateTimeStr}`;

    const delayMap = {};
    tdxList.forEach(item => {
        if (item.TrainNo) {
            delayMap[String(item.TrainNo)] = {
                delayTime: item.DelayTime || 0,
                currentStationName: item.StationName?.Zh_tw || ""
            };
        }
    });

    const dateStr = getTodayDateString();
    const scheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${dateStr}.json?t=${new Date().getTime()}`;

    try {
        const fullDaySchedule = await d3.json(scheduleUrl);
        globalScheduleData = fullDaySchedule; // 全域更新快取防爆
        renderUnifiedPassingTrains(fullDaySchedule, delayMap, targetTrainNumberToExpand);
    } catch (err) {
        document.getElementById("unified-train-list").innerHTML = `<p class="placeholder-text" style="color:#ef4444;">❌ 讀取當日靜態班次時刻表失敗 (${dateStr}.json)</p>`;
    }
}

function renderUnifiedPassingTrains(fullSchedule, delayMap, targetTrainNumberToExpand = null) {
    const listContainer = document.getElementById("unified-train-list");
    listContainer.innerHTML = "";

    const targetStationName = currentActiveStationName;
    const cwSet = new Set(currentActiveStationCW);
    const ccwSet = new Set(currentActiveStationCCW);

    const trainsList = [];

    fullSchedule.forEach(trainObj => {
        const dataStops = trainObj.data || [];
        
        let matchingIndex = -1;
        for (let i = 0; i < dataStops.length; i++) {
            if (dataStops[i].x === targetStationName) {
                matchingIndex = i;
                break;
            }
        }

        if (matchingIndex === -1) return;

        const currentStopRow = dataStops[matchingIndex];
        const prevStopRow = matchingIndex > 0 ? dataStops[matchingIndex - 1] : null;
        const nextStopRow = matchingIndex < dataStops.length - 1 ? dataStops[matchingIndex + 1] : null;

        let directionType = "unknown";
        if (nextStopRow && nextStopRow.x) {
            if (cwSet.has(nextStopRow.x)) directionType = "cw";
            else if (ccwSet.has(nextStopRow.x)) directionType = "ccw";
        }
        if (directionType === "unknown" && prevStopRow && prevStopRow.x) {
            if (cwSet.has(prevStopRow.x)) directionType = "ccw";
            else if (ccwSet.has(prevStopRow.x)) directionType = "cw";
        }

        if (directionType === "unknown") return;

        const scheduledMinutes = currentStopRow.y;
        const trainNumStr = String(trainObj.number);
        const liveInfo = delayMap[trainNumStr];
        const delayMins = liveInfo ? parseInt(liveInfo.delayTime, 10) || 0 : 0;
        const adjustedMinutes = scheduledMinutes + delayMins;

        trainsList.push({
            originalObject: trainObj,
            number: trainObj.number,
            train: trainObj.train,
            start: trainObj.info?.start || "未知",
            end: trainObj.info?.end || "未知",
            scheduledMinutes: scheduledMinutes,
            adjustedMinutes: adjustedMinutes,
            delayMins: delayMins,
            direction: directionType
        });
    });

    if (trainsList.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text">🛸 偵測完成：目前時空斷層區間內沒有任何班次通過此站。</p>`;
        return;
    }

    trainsList.sort((a, b) => a.adjustedMinutes - b.adjustedMinutes);

    let explicitTargetCardDOMElement = null;

    trainsList.forEach(t => {
        const card = document.createElement("div");
        card.className = `train-card ${t.direction}-card`;
        card.setAttribute("data-train-number", t.number);

        if (targetTrainNumberToExpand && String(t.number) === String(targetTrainNumberToExpand)) {
            explicitTargetCardDOMElement = card;
        }

        const hhmmText = convertMinutesToHHMM(t.adjustedMinutes);
        const neonColor = colorPalette[t.train] || "#64748b";

        let delayBadgeHTML = `<span class="delay-badge on-time">準點</span>`;
        if (t.delayMins > 0) {
            delayBadgeHTML = `<span class="delay-badge delayed">晚 ${t.delayMins} 分</span>`;
        }

        card.innerHTML = `
            <div class="train-header" style="border-left: 4px solid ${neonColor};">
                <div style="display: flex; justify-content: space-between; align-items: center; width:100%;">
                    <div>
                        <span class="train-type-badge" style="background: ${neonColor}22; color: ${neonColor}; border: 1px solid ${neonColor}55;">
                            ${t.train}
                        </span>
                        <span class="train-number-text">${t.number}</span>
                        <span class="route-bounds">${t.start} ➔ ${t.end}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="time-display-text">${hhmmText}</span>
                        ${delayBadgeHTML}
                    </div>
                </div>
            </div>
        `;

        card.querySelector(".train-header").addEventListener("click", () => {
            const alreadyExpanded = card.classList.contains("expanded");
            
            document.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));
            
            if (!alreadyExpanded) {
                card.classList.add("expanded");
                document.getElementById("app-container").classList.add("multi-split-mode");
                renderSchedulePanelContent(t.originalObject, targetStationName, neonColor);
            } else {
                document.getElementById("app-container").classList.remove("multi-split-mode");
            }
        });

        listContainer.appendChild(card);
    });

    // 建立一個不可見的 Spacer，用來避免 CSS Grid 在雙欄排版時，因最後一張卡片展開導致版面跳動
    const spacer = document.createElement("div");
    spacer.className = "train-card-spacer";
    listContainer.appendChild(spacer);

    // 處理反向選取或預設時間定位滾動
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
                        const matchedTrainObj = trainsList.find(t => String(t.number) === String(targetTrainNumberToExpand));
                        if (matchedTrainObj) {
                            const neonColor = colorPalette[matchedTrainObj.train] || "#64748b";
                            renderSchedulePanelContent(matchedTrainObj.originalObject, targetStationName, neonColor);
                        }
                    } else {
                        const matchedTrainObj = trainsList.find(t => String(t.number) === String(targetTrainNumberToExpand));
                        if (matchedTrainObj) {
                            const neonColor = colorPalette[matchedTrainObj.train] || "#64748b";
                            appContainer.classList.add("multi-split-mode");
                            renderSchedulePanelContent(matchedTrainObj.originalObject, targetStationName, neonColor);
                        }
                    }
                }

                listContainer.scrollTo({
                    top: explicitTargetCardDOMElement.offsetTop - listContainer.offsetTop - 10,
                    behavior: 'smooth'
                });
            }, 150);
        });
    } else {
        const currentMins = new Date().getHours() * 60 + new Date().getMinutes();
        let closestCard = null;
        let minDiff = Infinity;

        trainsList.forEach(t => {
            const diff = t.adjustedMinutes - currentMins;
            if (diff >= -15 && diff < minDiff) {
                minDiff = diff;
                closestCard = listContainer.querySelector(`[data-train-number="${t.number}"]`);
            }
        });

        if (closestCard) {
            setTimeout(() => {
                listContainer.scrollTo({
                    top: closestCard.offsetTop - listContainer.offsetTop - 10,
                    behavior: 'smooth'
                });
            }, 50);
        }
    }
}

async function renderSchedulePanelContent(trainRawObject, selectedStationName, neonColor) {
    const titleEl = document.getElementById("schedule-train-title");
    const routeEl = document.getElementById("schedule-train-route");
    const containerEl = document.getElementById("schedule-stops-container");

    titleEl.innerText = `${trainRawObject.train || "未知車型"} - ${trainRawObject.number || "車次"}`;
    routeEl.innerText = `${trainRawObject.info?.start || "起點"} ➔ ${trainRawObject.info?.end || "終點"}`;
    
    containerEl.innerHTML = `<p class="placeholder-text">⏳ 正在載入完整停靠站資訊...</p>`;

    const dataStops = trainRawObject.data || [];
    if (dataStops.length === 0) {
        containerEl.innerHTML = `<p class="placeholder-text">❌ 無法提供停靠明細資料欄位。</p>`;
        return;
    }

    const groupedStops = [];
    dataStops.forEach(entry => {
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

    let delayMinutesValue = 0;
    try {
        let liveBoardData = null;
        for (let attempts = 0; attempts < 3; attempts++) {
            try {
                liveBoardData = await d3.json(getLatestTDXUrl(attempts * 5));
                if (liveBoardData) break;
            } catch(e) {}
        }
        if (liveBoardData && Array.isArray(liveBoardData.TrainLiveBoards)) {
            const liveInfo = liveBoardData.TrainLiveBoards.find(b => String(b.TrainNo) === String(trainRawObject.number));
            if (liveInfo && liveInfo.DelayTime !== undefined && !isNaN(liveInfo.DelayTime)) {
                delayMinutesValue = parseInt(liveInfo.DelayTime, 10);
            }
        }
    } catch(e) {
        console.warn("Live board dynamic lookup error", e);
    }

    containerEl.innerHTML = "";
    
    const timelineList = document.createElement("div");
    timelineList.id = "stops-timeline-list";
    containerEl.appendChild(timelineList);

    groupedStops.forEach((stop, index) => {
        const item = document.createElement("div");
        item.className = "timeline-item";
        if (stop.stationName === selectedStationName) {
            item.classList.add("current-selected-stop");
        }

        const isStart = index === 0;
        const isEnd = index === groupedStops.length - 1;

        let timeStringHTML = "";
        if (isStart) {
            const finalDep = stop.depMinutes + delayMinutesValue;
            if (delayMinutesValue > 0) {
                timeStringHTML = `<span class="time-delayed-main">${convertMinutesToHHMM(finalDep)}</span>`;
            } else {
                timeStringHTML = `<span class="time-scheduled-main">${convertMinutesToHHMM(stop.depMinutes)}</span>`;
            }
            timeStringHTML += `<span class="time-type-label">開</span>`;
        } else if (isEnd) {
            const finalArr = stop.arrMinutes + delayMinutesValue;
            if (delayMinutesValue > 0) {
                timeStringHTML = `<span class="time-delayed-main">${convertMinutesToHHMM(finalArr)}</span>`;
            } else {
                timeStringHTML = `<span class="time-scheduled-main">${convertMinutesToHHMM(stop.arrMinutes)}</span>`;
            }
            timeStringHTML += `<span class="time-type-label">到</span>`;
        } else {
            const finalArr = stop.arrMinutes + delayMinutesValue;
            const finalDep = stop.depMinutes + delayMinutesValue;
            
            if (delayMinutesValue > 0) {
                timeStringHTML = `
                    <div style="display:flex; flex-direction:column; align-items:flex-end;">
                        <div><span class="time-delayed-main">${convertMinutesToHHMM(finalArr)}</span><span class="time-type-label">到</span></div>
                        <div><span class="time-delayed-main">${convertMinutesToHHMM(finalDep)}</span><span class="time-type-label">開</span></div>
                    </div>
                `;
            } else {
                timeStringHTML = `
                    <div style="display:flex; flex-direction:column; align-items:flex-end;">
                        <div><span class="time-scheduled-main">${convertMinutesToHHMM(stop.arrMinutes)}</span><span class="time-type-label">到</span></div>
                        <div><span class="time-scheduled-main">${convertMinutesToHHMM(stop.depMinutes)}</span><span class="time-type-label">開</span></div>
                    </div>
                `;
            }
        }

        item.innerHTML = `
            <div class="timeline-left-time">
                ${timeStringHTML}
            </div>
            <div class="timeline-node-wrapper">
                <div class="timeline-line-top"></div>
                <div class="timeline-dot" style="background-color: ${stop.stationName === selectedStationName ? neonColor : '#1e293b'}; border-color: ${neonColor};"></div>
                <div class="timeline-line-bottom"></div>
            </div>
            <div class="timeline-right-name">
                <span class="clickable-station-link">${stop.stationName}</span>
            </div>
        `;

        if (isStart) item.classList.add("is-start-node");
        if (isEnd) item.classList.add("is-end-node");

        item.querySelector(".clickable-station-link").addEventListener("click", () => {
            const targetName = stop.stationName;
            const d3Circles = mainGroup.selectAll(".station");
            let matchedNodeData = null;
            let matchedDOMNode = null;

            d3Circles.each(function(d) {
                if (getStationName(d) === targetName) {
                    matchedNodeData = d;
                    matchedDOMNode = this;
                }
            });

            if (matchedDOMNode && matchedNodeData) {
                if (window.innerWidth <= 768) {
                    // 行動裝置視窗邏輯：關閉時刻面板並切換顯示車站動態面板與滾動聚焦車次
                    const appContainer = document.getElementById("app-container");
                    appContainer.classList.remove("multi-split-mode");
                    selectStationElement(matchedDOMNode, matchedNodeData, String(trainRawObject.number));
                } else {
                    // 桌面端維持雙視窗連動
                    selectStationElement(matchedDOMNode, matchedNodeData, String(trainRawObject.number));
                }
            }
        });

        timelineList.appendChild(item);
    });
}

function initUnifiedSearchAutocomplete() {
    const searchInput = document.getElementById("unified-search-input");
    const suggestionsDropdown = document.getElementById("unified-suggestions");

    searchInput.addEventListener("input", function() {
        const rawValue = this.value.trim();
        const normalizedValue = rawValue.replace(/台/g, '臺').toLowerCase();
        suggestionsDropdown.innerHTML = "";

        if (!rawValue) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        // 1. 搜尋車站名稱
        const stationMatches = globalStationsData.filter(station => {
            const name = getStationName(station).toLowerCase();
            return name.includes(normalizedValue);
        });

        // 2. 搜尋車次代碼並進行數字升序排序
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

        // 渲染車站類別
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

        // 渲染車次類別 (全數顯示匹配車次)
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
                item.innerHTML = `<span style="color:#00f0ff; font-weight:bold;">${trainNum}</span> <span style="font-size:12px; color:#a1a1aa;">(${trainType}: ${startNode}➔${endNode})</span>`;
                
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

    searchInput.addEventListener("keydown", function(e) {
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

    d3Circles.each(function(d) {
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
            } catch(e) {}
        }
        if (liveBoardData && Array.isArray(liveBoardData.TrainLiveBoards)) {
            const liveInfo = liveBoardData.TrainLiveBoards.find(b => String(b.TrainNo) === String(trainNumber));
            if (liveInfo && liveInfo.DelayTime !== undefined && !isNaN(liveInfo.DelayTime)) {
                delayMinutesValue = parseInt(liveInfo.DelayTime, 10);
            }
        }
    } catch(e) {
        console.warn("Live board fetch failure during train routing selection", e);
    }

    const now = new Date();
    let currentHours = now.getHours();
    if (currentHours < 4) currentHours += 24; 
    const currentMinutesMidnight = currentHours * 60 + now.getMinutes();

    const firstStop = groupedStops[0];
    const lastStop = groupedStops[groupedStops.length - 1];

    let targetStationName = "";

    if (currentMinutesMidnight < (firstStop.arrMinutes + delayMinutesValue)) {
        targetStationName = firstStop.stationName;
    }
    else if (currentMinutesMidnight > (lastStop.depMinutes + delayMinutesValue)) {
        targetStationName = lastStop.stationName;
    }
    else {
        const nextUpcomingStop = groupedStops.find(stop => 
            (stop.depMinutes + delayMinutesValue) >= currentMinutesMidnight
        );
        targetStationName = nextUpcomingStop ? nextUpcomingStop.stationName : lastStop.stationName;
    }

    if (targetStationName) {
        const d3Circles = mainGroup.selectAll(".station");
        let matchedNodeData = null;
        let matchedDOMNode = null;

        d3Circles.each(function(d) {
            if (getStationName(d) === targetStationName) {
                matchedNodeData = d;
                matchedDOMNode = this;
            }
        });

        if (matchedDOMNode && matchedNodeData) {
            selectStationElement(matchedDOMNode, matchedNodeData, String(matchedTrain.number));
        } else {
            alert(`找不到對應的車站節點: ${targetStationName}`);
        }
    }
}

let autoRefreshTimer = null;
function scheduleNextAutoRefresh() {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    
    autoRefreshTimer = setTimeout(async () => {
        if (currentActiveStationCode && activeStationSelection) {
            console.log(`Auto refreshing live data for station: ${currentActiveStationName}`);
            const expandedCard = document.querySelector(".train-card.expanded");
            const targetTrainNo = expandedCard ? expandedCard.getAttribute("data-train-number") : null;
            await fetchLiveBoardData(targetTrainNo);
        }
        scheduleNextAutoRefresh();
    }, 45 * 1000); // 45秒自動更新一次
}

async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        try {
            globalStationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data file loading failed!");
        }
        
        const dateStr = getTodayDateString();
        const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Visualization/main/data_new/${dateStr}.json?t=${new Date().getTime()}`;
        try {
            globalScheduleData = await d3.json(targetScheduleUrl);
        } catch(e) {
            console.warn("Global daily schedules pre-cache failure", e);
        }

        drawMap(twData, globalStationsData);
        initUnifiedSearchAutocomplete();
        scheduleNextAutoRefresh();
    } catch (err) {
        console.error("Critical error during layout initialize:", err);
    }
}

loadData();

svg.on("click", () => {
    if (activeStationSelection) {
        const oldSelection = activeStationSelection;
        activeStationSelection = null;
        
        const currentTransform = d3.zoomTransform(svg.node());
        const k = currentTransform.k;
        
        d3.select(oldSelection).classed("active", false);
        d3.select(oldSelection.parentNode).classed("active", false);
        d3.select(oldSelection).attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }
    
    const appContainer = document.getElementById("app-container");
    appContainer.classList.remove("split-mode");
    appContainer.classList.remove("multi-split-mode");
    document.querySelectorAll(".train-card").forEach(c => c.classList.remove("expanded"));
});

document.getElementById("close-schedule-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("multi-split-mode");
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