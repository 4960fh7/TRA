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
// Global state variables tracking currently selected active station details
let currentActiveStationCode = null;
let currentActiveStationName = null;
let currentActiveStationAddress = null;

// Sci-Fi Dynamic Color Palette Mapping
const colorPalette = {
    "普悠瑪": "#FF5252",  
    "太魯閣": "#FFA726",  
    "新自強": "#ce6be0",  
    "自強": "#5ad362",    
    "莒光": "#FFEE58",    
    "區間快": "#5b7cfe",  
    "區間": "#00ffff"     
};

const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
        const k = event.transform.k;
        
        mainGroup.selectAll(".station")
            .attr("r", d => {
                if (activeStationSelection === d3.select(`circle[id='st-${d.properties.code}']`).node()) {
                    return Math.max(1.5, 6 / Math.sqrt(k));
                }
                return Math.max(0.6, 3 / Math.sqrt(k));
            })
            .style("stroke-width", `${0.5 / k}px`);

        mainGroup.selectAll(".county")
            .style("stroke-width", `${0.8 / k}px`);

        mainGroup.selectAll(".station-label")
            .style("font-size", `${Math.max(2, 10 / k)}px`)
            .attr("dy", `${Math.max(1.5, 4 / k)}px`);
    });

svg.call(zoom);

async function loadData() {
    try {
        const topology = await d3.json(mapUrl);
        const geojson = topojson.feature(topology, topology.objects.counties);

        mainGroup.selectAll(".county")
            .data(geojson.features)
            .enter()
            .append("path")
            .attr("class", "county")
            .attr("d", path);

        const stationsText = await d3.text("stations_lite.txt");
        globalStationsData = d3.csvParse(stationsText);

        const validStations = globalStationsData.filter(d => d.lat && d.lng);

        mainGroup.selectAll(".station")
            .data(validStations)
            .enter()
            .append("circle")
            .attr("class", "station")
            .attr("id", d => `st-${d.code}`)
            .attr("cx", d => projection([parseFloat(d.lng), parseFloat(d.lat)])[0])
            .attr("cy", d => projection([parseFloat(d.lng), parseFloat(d.lat)])[1])
            .attr("r", 3)
            .on("mouseover", function(event, d) {
                tooltip.style("opacity", 1)
                    .html(`<strong>${d.name}車站</strong><br>代碼: ${d.code}`)
                    .style("left", (event.pageX) + "px")
                    .style("top", (event.pageY) + "px");
                
                if (this !== activeStationSelection) {
                    d3.select(this).style("fill", "#ffffff");
                }
            })
            .on("mousemove", function(event) {
                tooltip.style("left", (event.pageX) + "px")
                    .style("top", (event.pageY) + "px");
            })
            .on("mouseout", function(event, d) {
                tooltip.style("opacity", 0);
                if (this !== activeStationSelection) {
                    d3.select(this).style("fill", "#00f0ff");
                }
            })
            .on("click", function(event, d) {
                selectStationElement(this, d);
            });

        mainGroup.selectAll(".station-label")
            .data(validStations)
            .enter()
            .append("text")
            .attr("class", "station-label")
            .attr("x", d => projection([parseFloat(d.lng), parseFloat(d.lat)])[0])
            .attr("y", d => projection([parseFloat(d.lng), parseFloat(d.lat)])[1])
            .attr("dy", "4px")
            .style("font-size", "10px")
            .text(d => d.name);

        initSearchFeature();
        
        // REQUIREMENT FIX: Initialize the clock tracking alignment loops
        scheduleNextAutoRefresh();

    } catch (error) {
        console.error("Data tracking process failed:", error);
    }
}

// REQUIREMENT FIX: Logic routing system execution targets to sync boundary updates
function scheduleNextAutoRefresh() {
    const now = new Date();
    const currentMinutes = now.getMinutes();
    
    // Calculate the target minute based on structural 5-minute boundaries offset by 1 minute
    let targetMinute = Math.floor(currentMinutes / 5) * 5 + 1;
    if (currentMinutes >= targetMinute) {
        targetMinute += 5;
    }
    
    const targetTime = new Date(now);
    targetTime.setMinutes(targetMinute);
    targetTime.setSeconds(0);
    targetTime.setMilliseconds(0);
    
    // If wrapping bounds crosses hours seamlessly standard date updates mutate
    const timeoutMs = targetTime.getTime() - now.getTime();
    
    console.log(`Synchronization daemon active. Refresh queued in ${Math.round(timeoutMs / 1000)}s at execution target: ${targetTime.toTimeString()}`);
    
    setTimeout(async () => {
        console.log("Triggering 5-minute auto-refresh sequence updates...");
        await refreshDataSilently();
        // Recurse to line up subsequent execution intervals
        scheduleNextAutoRefresh();
    }, timeoutMs);
}

// Triggers content data reload operations without interrupting focus or active UI layouts
async function refreshDataSilently() {
    if (currentActiveStationCode) {
        console.log(`Auto-updating data structures for active viewport: ${currentActiveStationName}`);
        await showStationInfoPanel(currentActiveStationCode, currentActiveStationName, currentActiveStationAddress);
    }
}

function selectStationElement(nodeElement, dataObj) {
    tooltip.style("opacity", 0);

    if (activeStationSelection) {
        d3.select(activeStationSelection)
            .classed("active", false)
            .attr("r", 3);
    }

    activeStationSelection = nodeElement;
    d3.select(nodeElement)
        .classed("active", true)
        .attr("r", 6);

    mainGroup.selectAll(".station").classed("connected", false);

    const coords = projection([parseFloat(dataObj.lng), parseFloat(dataObj.lat)]);
    
    const k = 12; 
    const x = coords[0];
    const y = coords[1];

    svg.transition()
        .duration(750)
        .call(
            zoom.transform,
            d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-x, -y)
        );

    showStationInfoPanel(dataObj.code, dataObj.name, dataObj.address);
}

async function showStationInfoPanel(code, name, address) {
    // Preserve current tracking parameters to feed auto refresh routines later
    currentActiveStationCode = code;
    currentActiveStationName = name;
    currentActiveStationAddress = address;

    document.getElementById("app-container").classList.add("split-mode");

    document.getElementById("station-details").innerHTML = `
        <h2>${name}</h2>
        <p><strong>車站代碼：</strong> ${code}</p>
        <p><strong>地　　址：</strong> ${address}</p>
    `;

    const unifiedListContainer = document.getElementById("unified-train-list");
    unifiedListContainer.innerHTML = `<p class="placeholder-text">Loading schedules & real-time delays...</p>`;

    try {
        const scheduleUrl = `timetable/${code}.json`;
        const timetableData = await d3.json(scheduleUrl);

        let liveBoardData = null;
        let delayMap = new Map();
        try {
            const liveDataUrl = `https://m7w6m99g71.execute-api.ap-northeast-1.amazonaws.com/prod/liveBoard?stationId=${code}`;
            liveBoardData = await d3.json(liveDataUrl);
            
            if (liveBoardData && liveBoardData.TrainLiveBoards) {
                liveBoardData.TrainLiveBoards.forEach(board => {
                    if (board.TrainNo) {
                        delayMap.set(String(board.TrainNo), board.DelayTime);
                    }
                });
            }
        } catch (liveErr) {
            console.warn("Live feedback link timed out. Defaulting to standard offline charts.", liveErr);
        }

        renderUnifiedPassingTrains(timetableData, name, unifiedListContainer, delayMap, liveBoardData);

    } catch (err) {
        console.error("Failed loading data:", err);
        unifiedListContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Error processing schedule records.</p>`;
    }
}

function convertMinutesToHHMM(totalMinutes) {
    const mins = totalMinutes % 1440; 
    const hours = Math.floor(mins / 60);
    const minutes = Math.floor(mins % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}

function renderUnifiedPassingTrains(trainsList, targetStationName, listContainer, delayMap, liveBoardData) {
    if (!Array.isArray(trainsList)) {
        listContainer.innerHTML = `<p class="placeholder-text">Malformed structure.</p>`;
        return;
    }

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
                if (stop.x && stop.x !== targetStationName) {
                    connectedStationNames.add(stop.x);
                }
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
    const isMobileViewport = window.innerWidth <= 768;

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
            if (train.delay === 0) {
                delayBadgeHTML = `<span class="delay-badge delay-ontime">準點</span>`;
            } else {
                delayBadgeHTML = `<span class="delay-badge delay-late">晚 ${train.delay} 分</span>`;
            }
        } else {
            if (rawLiveBoardInfo) {
                if (rawLiveBoardInfo.TrainStationStatus === 0) {
                    delayBadgeHTML = `<span class="delay-badge delay-status">未發車</span>`;
                } else if (rawLiveBoardInfo.TrainStationStatus === 2) {
                    delayBadgeHTML = `<span class="delay-badge delay-status">已收班</span>`;
                } else {
                    delayBadgeHTML = `<span class="delay-badge delay-unknown">未知</span>`;
                    isActivelyInService = true;
                }
            } else {
                if (currentMinutesMidnight > train.calculatedDepMinutes + 30) {
                    delayBadgeHTML = `<span class="delay-badge delay-status">已收班</span>`;
                } else {
                    delayBadgeHTML = `<span class="delay-badge delay-status">未發車</span>`;
                }
            }
        }

        let timeDisplayHTML = "";
        if (train.delay !== undefined && train.delay > 0) {
            timeDisplayHTML = `
                <span class="scheduled-time-strike">${train.formattedTime}</span>
                <strong style="color: ${neonColor}">${train.formattedDelayedTime}</strong>
            `;
        } else {
            timeDisplayHTML = `<strong style="color: ${neonColor}">${train.formattedTime}</strong>`;
        }

        let currentPositionHTML = "";
        if (isActivelyInService && rawLiveBoardInfo && rawLiveBoardInfo.StationName && rawLiveBoardInfo.StationName.Zh_tw) {
            currentPositionHTML = `<br><span style="color: #00f0ff; font-weight: bold; font-size: 11px;">目前位置：${rawLiveBoardInfo.StationName.Zh_tw}</span>`;
        }

        card.innerHTML = `
            <div class="train-header" style="border-bottom: 1px dashed rgba(${hexToRgb(neonColor)}, 0.15)">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div>
                        ${timeDisplayHTML}
                        <span style="color: ${neonColor}; font-weight: bold; margin-left: 4px;">${trainType} ${trainNumber}</span>
                    </div>
                    ${delayBadgeHTML}
                </div>
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details" style="border-left: 2px solid ${neonColor}">
                ${startText} → ${endText} ${currentPositionHTML} <br>
                <span style="color: #64748b; display: inline-block; margin-top: 4px;">備註：${noteText}</span>
            </div>
        `;

        card.querySelector(".train-header").addEventListener("click", () => {
            card.classList.toggle("expanded");
        });

        if (isMobileViewport) {
            listContainer.appendChild(card);
        } else {
            if (isEven) {
                listContainer.appendChild(spacerCard);
                listContainer.appendChild(card);
            } else {
                listContainer.appendChild(card);
                listContainer.appendChild(spacerCard);
            }
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

function getStationName(d) {
    if (d.properties && d.properties.name) return d.properties.name;
    if (d.name) return d.name;
    return "";
}

function initSearchFeature() {
    const searchInput = document.getElementById("station-search-input");
    const suggestionsDropdown = document.getElementById("search-suggestions");

    if (!searchInput || !suggestionsDropdown) return;

    searchInput.addEventListener("input", function() {
        const query = this.value.trim().toLowerCase();
        suggestionsDropdown.innerHTML = "";

        if (!query) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        const filtered = globalStationsData.filter(station => {
            const nameMatch = station.name && station.name.toLowerCase().includes(query);
            const codeMatch = station.code && station.code.includes(query);
            return nameMatch || codeMatch;
        });

        if (filtered.length === 0) {
            suggestionsDropdown.style.display = "none";
            return;
        }

        filtered.slice(0, 10).forEach(station => {
            const item = document.createElement("div");
            item.className = "suggestion-item";
            item.innerHTML = `<strong>${station.name}</strong> <span style="font-size:11px; color:#64748b; float:right;">碼: ${station.code}</span>`;
            
            item.addEventListener("click", () => {
                searchInput.value = station.name;
                suggestionsDropdown.style.display = "none";
                triggerSelectionByStationName(station.name);
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
        if (e.target !== searchInput) {
            suggestionsDropdown.style.display = "none";
        }
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
        alert("Station not found. Please clarify spelling entries.");
    }
}

document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
    
    // Clear global background tracking states
    currentActiveStationCode = null;
    currentActiveStationName = null;
    currentActiveStationAddress = null;

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