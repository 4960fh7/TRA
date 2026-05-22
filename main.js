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

// Keep track of the currently selected circle node
let activeStationSelection = null;

// Zoom configuration
const zoom = d3.zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
        const k = event.transform.k;
        mainGroup.selectAll(".station")
            .attr("r", Math.max(1, 4 / Math.sqrt(k))) 
            .style("stroke-width", `${0.5 / k}px`);
    });

svg.call(zoom);

// Generate Today's Date String (Format: YYYYMMDD)
function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

// Minute number to absolute timestamp calculator string conversion
function convertMinutesToHHMM(totalMinutes) {
    // Drop remaining fraction decimals completely via integer truncation floor
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

async function loadData() {
    try {
        const twData = await d3.json(mapUrl);
        let stationsData = [];
        try {
            stationsData = await d3.json("stations.json");
        } catch (e) {
            console.warn("Stations data file loading failed!");
        }
        drawMap(twData, stationsData);
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
        .attr("class", "station") // Starts out black based on CSS definitions
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
            
            const name = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
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
            
            // 1. Reset color of previous selection and color the current one red
            if (activeStationSelection) {
                activeStationSelection.classList.remove("active");
            }
            this.classList.add("active");
            activeStationSelection = this;

            const stationCode = d.stationCode || d['車站代碼'] || d.id || "";
            const stationName = d.stationName || d['車站中文名稱'] || d.name || "Unknown Station";
            const stationAddrTw = d.stationAddrTw || d['站址'] || d.address || "N/A";

            showStationInfoPanel(stationCode, stationName, stationAddrTw);
        });
}

async function showStationInfoPanel(code, name, address) {
    document.getElementById("app-container").classList.add("split-mode");

    const detailsContainer = document.getElementById("station-details");
    detailsContainer.innerHTML = `
        <h2>${name}</h2>
        <p><strong>Station Code:</strong> ${code}</p>
        <p><strong>Address:</strong> ${address}</p>
    `;

    const listContainer = document.getElementById("train-list-container");
    listContainer.innerHTML = `<p class="placeholder-text">Fetching live schedule tracking logs...</p>`;

    const dateStr = getTodayDateString();
    const targetScheduleUrl = `https://raw.githubusercontent.com/4960fh7/TRA_Diagram/main/data/${dateStr}.json`;

    try {
        const scheduleData = await d3.json(targetScheduleUrl);
        renderPassingTrains(scheduleData, name, listContainer);
    } catch (error) {
        console.error(error);
        listContainer.innerHTML = `<p class="placeholder-text" style="color:#ef4444;">Could not load schedule dataset for date (${dateStr}).</p>`;
    }
}

function renderPassingTrains(trainsList, targetStationName, listContainer) {
    if (!Array.isArray(trainsList)) {
        listContainer.innerHTML = `<p class="placeholder-text">Malformed JSON structure.</p>`;
        return;
    }

    const processedTrains = [];

    trainsList.forEach(train => {
        const routeStops = train.data || [];
        
        // Find all stops matching this station name
        const matchingStops = routeStops.filter(stop => stop.x === targetStationName);
        
        if (matchingStops.length > 0) {
            // Find departure timestamp (last element index sequence matching the target station name)
            const depStop = matchingStops[matchingStops.length - 1];
            const departureMinutes = depStop.y;
            
            processedTrains.push({
                ...train,
                calculatedDepMinutes: departureMinutes,
                formattedTime: convertMinutesToHHMM(departureMinutes)
            });
        }
    });

    if (processedTrains.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text">No active operations scheduled through this station today.</p>`;
        return;
    }

    // 4. Sort columns ascending using the calculated departure timeline coordinates
    processedTrains.sort((a, b) => a.calculatedDepMinutes - b.calculatedDepMinutes);

    listContainer.innerHTML = ""; // Clear wrapper container elements

    processedTrains.forEach(train => {
        const card = document.createElement("div");
        card.className = "train-card";

        const trainType = train.train || "N/A";
        const trainNumber = train.number || "N/A";
        
        const infoObj = train.info || {};
        const viaLine = infoObj.via || "-";
        const rawEndStr = infoObj.end || "";
        
        // Emulate Python strip logic: strip first 6 chars ("18:19 ") to reveal terminal base target ("永康")
        const endStationTrimmed = rawEndStr.length > 6 ? rawEndStr.substring(6) : rawEndStr;

        // 3. Format conditional segments string structures
        const viaSegment = (viaLine !== "-") ? `經${viaLine}線 ` : "";
        const routeSubtitleText = `${viaSegment}往 ${endStationTrimmed}`;

        const startText = infoObj.start || "N/A";
        const endText = rawEndStr || "N/A";
        const noteText = infoObj.note || "無";

        // Construct interactive HTML card
        card.innerHTML = `
            <div class="train-header">
                <strong>${train.formattedTime}</strong> ${trainType} ${trainNumber}
                <span class="train-sub-title">${routeSubtitleText}</span>
            </div>
            <div class="train-details">
                ${startText} → ${endText} 註：${noteText}
            </div>
        `;

        // 2. Click to toggle info block layout display conditions
        card.querySelector(".train-header").addEventListener("click", () => {
            card.classList.toggle("expanded");
        });

        listContainer.appendChild(card);
    });
}

// Reset view on closing side info panel
document.getElementById("close-panel-btn").addEventListener("click", () => {
    document.getElementById("app-container").classList.remove("split-mode");
    if (activeStationSelection) {
        activeStationSelection.classList.remove("active");
        activeStationSelection = null;
    }
});

loadData();