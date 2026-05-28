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

// Sci-Fi Dynamic Color Palette Mapping
const colorPalette = {
    "普悠瑪": "#FF5252",  // Lightened to a vibrant, high-visibility coral red
    "太魯閣": "#FFA726",  // Shifted to a bright, glowing orange
    "新自強": "#ce6be0",  // Changed from deep purple to a luminous lavender/magenta
    "自強": "#5ad362",    // Swapped forest green for a crisp, bright mint/emerald green
    "莒光": "#FFEE58",    // Brightened to a vivid, high-contrast yellow
    "區間快": "#5b7cfe",  // Shifted from dark indigo to a vibrant neon purple/blue
    "區間": "#00ffff"     // Kept cyan as it inherently boasts excellent contrast on dark backgrounds
};

// Zoom configuration behavior logic
const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
        const k = event.transform.k;
        
        mainGroup.selectAll(".station")
            .attr("r", d => {
                const base = (activeStationSelection && d3.select(activeStationSelection).datum() === d) ? 5 : 4;
                return Math.max(1, base / Math.sqrt(k));
            })
            .style("stroke-width", `${0.5 / k}px`);

        mainGroup.selectAll(".station-label")
            .style("font-size", `${Math.max(3, 11 / Math.sqrt(k))}px`)
            .attr("dx", Math.max(2, 6 / Math.sqrt(k)))
            .attr("dy", Math.max(1, 3 / Math.sqrt(k)))
            .style("opacity", k > 2.5 ? 1 : 0);
    });

svg.call(zoom);

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
    } catch (err) {
        console.error("Error configuration mapping pipeline:", err);
    }
}

function drawMap(twData, stationsData) {
    const objectsKey = Object.keys(twData.objects)[0];
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
            const baseRadius = 4 / Math.sqrt(currentTransform.k);
            d3.select(this).attr("r", baseRadius * 1.5);
            
            const name = getStationName(d);
            tooltip.style("opacity", 1)
                   .html(name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            const currentTransform = d3.zoomTransform(svg.node());
            d3.select(this).attr("r", Math.max(1, 4 / Math.sqrt(currentTransform.k)));
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            event.stopPropagation();
            selectStationElement(this, d);
        });

    mainGroup.selectAll(".station-label")
        .data(stationsData)
        .enter()
        .append("text")
        .attr("class", "station-label")
        .attr("x", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[0] : -9999;
        })
        .attr("y", d => {
            const coords = getCoords(d);
            return coords ? projection([coords.lon, coords.lat])[1] : -9999;
        })
        .style("opacity", 0) 
        .text(d => getStationName(d));
}

function selectStationElement(circleDOM, d) {
    if (activeStationSelection) {
        d3.select(activeStationSelection).classed("active", false);
    }
    
    mainGroup.selectAll(".station").classed("connected", false);

    d3.select(circleDOM).classed("active", true);
    activeStationSelection = circleDOM;

    const stationCode = d.stationCode || d['車站代碼'] || d.id || "";
    const stationName = getStationName(d);
    const stationAddrTw = d.stationAddrTw || d['站址'] || d.address || "N/A";

    showStationInfoPanel(stationCode, stationName, stationAddrTw);
    
    const coords = getCoords(d);
    if (coords) {
        const projectedCoords = projection([coords.lon, coords.lat]);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(8).translate(-projectedCoords[0], -projectedCoords[1]));
    }
}

async function showStationInfoPanel(code, name, address) {
    document.getElementById("app-container").classList.add("split-mode");

    document.getElementById("station-details").innerHTML = `
        <h2>${name}</h2>
        <p><strong>車站代碼：</strong> ${code}</p>
        <p><strong>地　　址：</strong> ${address}</p>
    `;

    const unifiedListContainer = document.getElementById("unified-train-list");
    unifiedListContainer.innerHTML = `<p class="placeholder-text">Loading schedules...</p>`;

    const dateStr = getTodayDateString();
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json`;

    try {
        const scheduleData = await d3.json(targetScheduleUrl);
        renderUnifiedPassingTrains(scheduleData, name, unifiedListContainer);
    } catch (error) {
        console.error(error);
        unifiedListContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load logs.</p>`;
    }
}

function renderUnifiedPassingTrains(trainsList, targetStationName, listContainer) {
    if (!Array.isArray(trainsList)) {
        listContainer.innerHTML = `<p class="placeholder-text">Malformed structure.</p>`;
        return;
    }

    const connectedStationNames = new Set();
    const combinedSortedTrains = [];

    trainsList.forEach(train => {
        const routeStops = train.data || [];
        const matchingStops = routeStops.filter(stop => stop.x === targetStationName);
        
        if (matchingStops.length > 0) {
            const depStop = matchingStops[matchingStops.length - 1];
            const departureMinutes = depStop.y;
            
            const trainData = {
                ...train,
                calculatedDepMinutes: departureMinutes,
                formattedTime: convertMinutesToHHMM(departureMinutes)
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

    // Chronological Sort
    combinedSortedTrains.sort((a, b) => a.calculatedDepMinutes - b.calculatedDepMinutes);

    listContainer.innerHTML = ""; 

    combinedSortedTrains.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

        const trainType = train.train || "N/A";
        const trainNumber = train.number || "N/A";
        
        // Define Column Placements
        const trainNumberInt = parseInt(trainNumber, 10);
        const isEven = (!isNaN(trainNumberInt) && trainNumberInt % 2 === 0);

        // Create the counterpart visual empty spacer node
        const spacerCard = document.createElement("div");

        if (isEven) {
            card.classList.add("side-right");
            spacerCard.className = "train-card-spacer side-left";
        } else {
            card.classList.add("side-left");
            spacerCard.className = "train-card-spacer side-right";
        }

        // Apply Custom Sci-Fi Theme Color Palette Configs
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

        card.innerHTML = `
            <div class="train-header" style="border-bottom: 1px dashed rgba(${hexToRgb(neonColor)}, 0.15)">
                <strong style="color: ${neonColor}">${train.formattedTime}</strong> 
                <span style="color: ${neonColor}; font-weight: bold;">${trainType} ${trainNumber}</span>
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details" style="border-left: 2px solid ${neonColor}">
                ${startText} → ${endText} <br>
                <span style="color: #64748b">${noteText}</span>
            </div>
        `;

        card.querySelector(".train-header").addEventListener("click", () => {
            card.classList.toggle("expanded");
        });

        // Append both items to the list container based on direction
        if (isEven) {
            listContainer.appendChild(spacerCard); // Left Blank
            listContainer.appendChild(card);       // Right Train
        } else {
            listContainer.appendChild(card);       // Left Train
            listContainer.appendChild(spacerCard); // Right Blank
        }
    });
}

function hexToRgb(hex) {
    let c = hex.substring(1);
    if(c.length === 3) {
        c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    }
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
                // Clear query strings immediately
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
                // Clear text string entries cleanly
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
    if (activeStationSelection) {
        d3.select(activeStationSelection).classed("active", false);
        activeStationSelection = null;
    }
    mainGroup.selectAll(".station").classed("connected", false);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
});

loadData();