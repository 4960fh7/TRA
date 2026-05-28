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

// 全域力學模擬器變數
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

        // 當縮放比例大於 8 時顯示標籤
        if (k > 8.0) {
            mainGroup.selectAll(".station-label").style("opacity", 1);
            updateLabelForceSimulation(k);
        } else {
            mainGroup.selectAll(".station-label").style("opacity", 0);
            if (labelSimulation) labelSimulation.stop();
        }
    });

svg.call(zoom);

// 關鍵修復：專門用來計算、排斥重疊、且絕不壓到車站圓圈的力學模擬
// 關鍵修復：因為要求標籤完全固定不動，移除複雜的力學模擬系統，改用靜態位置計算
function updateLabelForceSimulation(k) {
    // 停止任何可能殘留的力學模擬
    if (labelSimulation) {
        labelSimulation.stop();
        labelSimulation = null;
    }

    const fontSize = Math.max(2.5, 9 / Math.sqrt(k));
    const activeCircleRadius = 4 / Math.sqrt(k);
    const standardCircleRadius = 3 / Math.sqrt(k);

    // 靜態計算並固定文字標籤的位置與字體大小
    mainGroup.selectAll(".station-label")
        .style("font-size", `${fontSize}px`)
        .attr("x", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("y", d => {
            const coords = getCoords(d);
            if (!coords) return -9999;
            const pos = projection([coords.lon, coords.lat]);
            const isCurrentActive = activeStationSelection && d3.select(activeStationSelection).datum() === d;
            const r = isCurrentActive ? activeCircleRadius : standardCircleRadius;
            
            // 將標籤固定放置在車站圓圈的上方（扣除半徑外加一個固定呼吸安全邊距）
            return pos[1] - r - (4 / k);
        });
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

    // 1. 先建立車站圓圈節點
    const circles = mainGroup.selectAll(".station")
        .data(stationsData)
        .enter()
        .append("circle")
        .attr("class", "station")
        .attr("r", 4)
        .attr("cx", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("cy", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .on("mouseover", function(event, d) {
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            const currentBaseRadius = Math.max(0.6, base / Math.sqrt(k));
            
            d3.select(this).attr("r", currentBaseRadius * 1.5);
            
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
            
            d3.select(this).attr("r", Math.max(0.6, base / Math.sqrt(k)));
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            event.stopPropagation();
            selectStationElement(this, d);
        });

    // 2. 建立文字標籤節點（使其同步支援點擊事件與動態色彩）
    mainGroup.selectAll(".station-label")
        .data(stationsData)
        .enter()
        .append("text")
        .attr("class", "station-label")
        .style("opacity", 0) 
        .text(d => getStationName(d))
        // 核心修改 1 & 3: 綁定與圓圈完全一模一樣的滑鼠與點擊事件
        .on("mouseover", function(event, d) {
            // 觸發對應圓圈的放大視覺特效
            const correspondingCircle = circles.filter(cData => cData === d);
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            correspondingCircle.attr("r", Math.max(0.6, base / Math.sqrt(k)) * 1.5);

            const name = getStationName(d);
            tooltip.style("opacity", 1)
                   .html(name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function(event, d) {
            // 還原對應圓圈的半徑
            const correspondingCircle = circles.filter(cData => cData === d);
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            correspondingCircle.attr("r", Math.max(0.6, base / Math.sqrt(k)));
            
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            event.stopPropagation();
            // 找出與此文字標籤對應的圓圈 DOM 元素，一併傳入現有的 selectStationElement 邏輯
            const correspondingCircleNode = circles.filter(cData => cData === d).node();
            selectStationElement(correspondingCircleNode, d);
        });
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
        drawMap(twData, globalStationsData);
        initSearchAutocomplete();
        scheduleNextAutoRefresh();
    } catch (err) {
        console.error("Error configuration mapping pipeline:", err);
    }
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

    mainGroup.selectAll(".station")
        .data(stationsData)
        .enter()
        .append("circle")
        .attr("class", "station")
        .attr("r", 4)
        .attr("cx", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("cy", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .on("mouseover", function(event, d) {
            const currentTransform = d3.zoomTransform(svg.node());
            const k = currentTransform.k;
            const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 4 : 3;
            const currentBaseRadius = Math.max(0.6, base / Math.sqrt(k));
            
            d3.select(this).attr("r", currentBaseRadius * 1.5);
            
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
            
            d3.select(this).attr("r", Math.max(0.6, base / Math.sqrt(k)));
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            event.stopPropagation();
            selectStationElement(this, d);
        });

    // 繪製初始文字標籤
    mainGroup.selectAll(".station-label")
        .data(stationsData)
        .enter()
        .append("text")
        .attr("class", "station-label")
        .style("opacity", 0) 
        .text(d => getStationName(d));
}

function selectStationElement(circleDOM, d) {
    if (activeStationSelection) {
        const oldSelection = activeStationSelection;
        activeStationSelection = null;
        
        const currentTransform = d3.zoomTransform(svg.node());
        const k = currentTransform.k;
        d3.select(oldSelection)
          .classed("active", false)
          .attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }
    
    mainGroup.selectAll(".station").classed("connected", false);

    d3.select(circleDOM).classed("active", true);
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
    
    // 選取車站時觸發一次力學系統重新定位，確保文字順暢讓開
    if (k > 8.0) updateLabelForceSimulation(k);

    const coords = getCoords(d);
    if (coords) {
        const projectedCoords = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(8).translate(-projectedCoords[0], -projectedCoords[1]));
    }
}

function getLatestTDXUrl() {
    const now = new Date();
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

    document.getElementById("station-details").innerHTML = `
        <h2>${name}</h2>
        <p><strong>車站代碼：</strong> ${code}</p>
        <p><strong>地　　址：</strong> ${address}</p>
    `;

    const ccwIndicatorElement = document.querySelector(".dir-indicator.ccw-ind");
    const cwIndicatorElement = document.querySelector(".dir-indicator.cw-ind");
    if (ccwIndicatorElement) ccwIndicatorElement.innerHTML = `逆行往 ${ccwTarget}`;
    if (cwIndicatorElement) cwIndicatorElement.innerHTML = `順行往 ${cwTarget}`;

    const trainWrapper = document.getElementById("unified-train-wrapper");
    if (trainWrapper) {
        trainWrapper.style.height = window.innerWidth <= 768 ? "calc(100vh - 320px)" : "75%";
    }

    const unifiedListContainer = document.getElementById("unified-train-list");
    unifiedListContainer.innerHTML = `<p class="placeholder-text">Loading schedules & real-time delays...</p>`;

    const dateStr = getTodayDateString();
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json?t=${new Date().getTime()}`;
    const liveBoardUrl = getLatestTDXUrl();

    try {
        const [scheduleData, liveBoardData] = await Promise.all([
            d3.json(targetScheduleUrl),
            d3.json(liveBoardUrl).catch(err => null)
        ]);

        let updateBadge = document.getElementById("live-data-update-time-badge");
        if (!updateBadge) {
            updateBadge = document.createElement("div");
            updateBadge.id = "live-data-update-time-badge";
            updateBadge.style.cssText = "float: right; margin-right: 10px; background: #162238; border: 1px solid #00f0ff; color: #00f0ff; padding: 6px 14px; border-radius: 2px; font-size: 11px; font-weight: bold; text-transform: uppercase;";
            const closeBtn = document.getElementById("close-panel-btn");
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
            <div class="train-header" style="border-bottom: 1px dashed rgba(${hexToRgb(neonColor)}, 0.15)">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div>
                        ${timeDisplayHTML}<br>
                        <strong style="color: ${neonColor}; font-weight: bold;">${trainType} ${trainNumber}</strong>
                    </div>
                    ${delayBadgeHTML}
                </div>
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details" style="border-left: 1px solid ${neonColor}">
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

        if (!upcomingTrainDOMElement && train.sortingMinutes >= currentMinutesMidnight) {
            upcomingTrainDOMElement = card;
        }
    });

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
        d3.select(oldSelection)
          .classed("active", false)
          .attr("r", Math.max(0.6, 3 / Math.sqrt(k)));
    }
    mainGroup.selectAll(".station").classed("connected", false);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
});

loadData();